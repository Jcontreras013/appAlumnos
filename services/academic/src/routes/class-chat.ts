import { conflict, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type AssignmentDto,
  type ClassChatDto,
  type ClassChatMessageDto,
  type ClassChatSummaryDto,
  classChatInputSchema,
  classChatStatusSchema,
} from "@escolar/shared";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { type ClassChatMessage, classChatMessages, virtualClasses } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { type ClassAccess, classAccess, classesOfStudent } from "../lib/classroom";
import { teacherClasses } from "../lib/evaluation";
import { studentOf } from "../lib/family";
import { findCurrentYear, listAssignments } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const afterQuery = z.object({ despues: z.iso.datetime({ offset: true }).optional() });
const READERS = ["admin", "coordinador", "secretaria", "docente", "estudiante"] as const;
/** Cuántos mensajes trae la página al abrir el chat. */
const PAGE = 100;

const toDto = (m: ClassChatMessage, me: string): ClassChatMessageDto => ({
  id: m.id,
  authorName: m.authorName,
  authorRole: m.authorRole as ClassChatMessageDto["authorRole"],
  mine: m.authorUserId === me,
  body: m.deletedAt ? null : m.body,
  createdAt: m.createdAt.toISOString(),
});

/**
 * Chat de toda la clase: el maestro y los alumnos de la sección conversan en un solo lugar. Lo abre y
 * lo cierra el maestro (viene cerrado), que puede borrar cualquier mensaje; la dirección y la
 * coordinación lo pueden leer y moderar. Las familias no lo ven (son conversaciones entre compañeros).
 */
export async function classChatRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const readers = { preHandler: [app.authenticate, requireRole(...READERS)] };

  async function chatContext(request: FastifyRequest, id: string) {
    const access = await classAccess(db, request.auth, id, today());
    if (access.viewer === "familia") throw notFound("Clase no encontrada");
    const [settings] = await db.select().from(virtualClasses).where(eq(virtualClasses.assignmentId, id));
    return { access, enabled: settings?.chatEnabled ?? false };
  }
  /**
   * Escriben quien da la clase (o su sustituto) y los alumnos de la sección. La dirección y la
   * coordinación pueden editar cualquier clase, pero en el chat solo leen y moderan.
   */
  const writer = (access: ClassAccess, auth: FastifyRequest["auth"]) =>
    access.viewer === "alumno" ||
    (access.canEdit && (auth.role === "docente" || access.assignment.teacherUserId === auth.userId));
  /** Moderan quien da la clase y la dirección o coordinación. */
  const moderator = (access: ClassAccess, role: string) =>
    access.canEdit || role === "admin" || role === "coordinador";

  /**
   * El apartado «Chats»: los chats de las clases de quien pregunta (el maestro, las suyas; el alumno,
   * las de su sección). La dirección y la coordinación ven los chats abiertos de todo el centro.
   */
  app.get("/class-chats", readers, async (request): Promise<ClassChatSummaryDto[]> => {
    const schoolId = tenantOf(request);
    const { role, userId } = request.auth;
    let classes: AssignmentDto[] = [];
    let onlyOpen = false;
    if (role === "estudiante") {
      const studentId = await studentOf(db, schoolId, userId);
      classes = studentId ? await classesOfStudent(db, schoolId, studentId) : [];
    } else if (role === "docente") {
      classes = (await teacherClasses(db, schoolId, userId, today())).map((c) => c.assignment);
    } else if (role === "admin" || role === "coordinador") {
      const year = await findCurrentYear(db, schoolId);
      classes = year ? await listAssignments(db, schoolId, { schoolYearId: year.id }) : [];
      onlyOpen = true;
    }
    if (!classes.length) return [];
    const ids = classes.map((c) => c.id);
    const [settings, lasts] = await Promise.all([
      db
        .select({ id: virtualClasses.assignmentId, enabled: virtualClasses.chatEnabled })
        .from(virtualClasses)
        .where(inArray(virtualClasses.assignmentId, ids)),
      db
        .selectDistinctOn([classChatMessages.assignmentId])
        .from(classChatMessages)
        .where(inArray(classChatMessages.assignmentId, ids))
        .orderBy(classChatMessages.assignmentId, desc(classChatMessages.createdAt)),
    ]);
    const open = new Map(settings.map((s) => [s.id, s.enabled]));
    const last = new Map(lasts.map((m) => [m.assignmentId, m]));
    return (
      classes
        .map((c): ClassChatSummaryDto => {
          const m = last.get(c.id);
          return {
            assignmentId: c.id,
            subjectName: c.subjectName,
            sectionLabel: c.sectionLabel,
            teacherName: c.teacherName,
            enabled: open.get(c.id) ?? false,
            last: m
              ? {
                  authorName: m.authorName,
                  body: m.deletedAt ? null : m.body,
                  createdAt: m.createdAt.toISOString(),
                }
              : null,
          };
        })
        .filter((c) => !onlyOpen || c.enabled || c.last)
        // Primero los que tienen mensajes recientes; después, por materia.
        .sort(
          (a, b) =>
            (b.last?.createdAt ?? "").localeCompare(a.last?.createdAt ?? "") ||
            a.subjectName.localeCompare(b.subjectName, "es"),
        )
    );
  });

  app.get("/classes/:id/chat", readers, async (request): Promise<ClassChatDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { despues } = parseOrThrow(afterQuery, request.query);
    const { access, enabled } = await chatContext(request, id);
    const rows = await db
      .select()
      .from(classChatMessages)
      .where(
        and(
          eq(classChatMessages.assignmentId, id),
          despues ? gt(classChatMessages.createdAt, new Date(despues)) : undefined,
        ),
      )
      .orderBy(desc(classChatMessages.createdAt))
      .limit(PAGE);
    return {
      subjectName: access.assignment.subjectName,
      sectionLabel: access.assignment.sectionLabel,
      teacherName: access.assignment.teacherName,
      enabled,
      canWrite: enabled && writer(access, request.auth),
      canModerate: moderator(access, request.auth.role),
      messages: rows.reverse().map((m) => toDto(m, request.auth.userId)),
    };
  });

  app.post(
    "/classes/:id/chat",
    { ...readers, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = parseOrThrow(idParams, request.params);
      const { access, enabled } = await chatContext(request, id);
      if (!writer(access, request.auth))
        throw forbidden("En este chat escriben el maestro y los alumnos de la clase");
      if (!enabled) throw conflict("El chat de la clase está cerrado");
      const { body } = parseOrThrow(classChatInputSchema, request.body);
      const [row] = await db
        .insert(classChatMessages)
        .values({
          schoolId: tenantOf(request),
          assignmentId: id,
          authorUserId: request.auth.userId,
          authorName: request.auth.name,
          authorRole: access.viewer === "alumno" ? "alumno" : "maestro",
          body,
        })
        .returning();
      if (!row) throw new Error("No se guardó el mensaje");
      return reply.status(201).send(toDto(row, request.auth.userId));
    },
  );

  /** Borrar un mensaje: su autor, o quien modera. Queda «Mensaje borrado». */
  app.delete("/class-chat/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const [message] = await db
      .select()
      .from(classChatMessages)
      .where(and(eq(classChatMessages.schoolId, tenantOf(request)), eq(classChatMessages.id, id)));
    if (!message) throw notFound("Mensaje no encontrado");
    const { access } = await chatContext(request, message.assignmentId);
    const own = message.authorUserId === request.auth.userId;
    const moderating = moderator(access, request.auth.role);
    if (!own && !moderating) throw forbidden("Solo puedes borrar tus mensajes");
    if (!message.deletedAt) {
      await db.transaction(async (tx) => {
        await tx
          .update(classChatMessages)
          .set({ body: null, deletedAt: new Date(), deletedByUserId: request.auth.userId })
          .where(eq(classChatMessages.id, id));
        // Lo que borra quien modera queda en la bitácora (sin el texto).
        if (!own) {
          await audit(tx, request, {
            action: "class_chat.message_deleted",
            entityType: "class",
            entityId: message.assignmentId,
            data: { author: message.authorName },
          });
        }
      });
    }
    return reply.status(204).send();
  });

  /** Abrir o cerrar el chat de la clase. */
  app.put("/classes/:id/chat/estado", readers, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { access } = await chatContext(request, id);
    if (!moderator(access, request.auth.role)) throw forbidden("El chat lo abre o lo cierra el maestro");
    const { enabled } = parseOrThrow(classChatStatusSchema, request.body);
    await db.transaction(async (tx) => {
      await tx
        .insert(virtualClasses)
        .values({
          schoolId: tenantOf(request),
          assignmentId: id,
          chatEnabled: enabled,
          updatedByUserId: request.auth.userId,
        })
        .onConflictDoUpdate({
          target: virtualClasses.assignmentId,
          set: { chatEnabled: enabled, updatedByUserId: request.auth.userId, updatedAt: new Date() },
        });
      await audit(tx, request, {
        action: enabled ? "class_chat.opened" : "class_chat.closed",
        entityType: "class",
        entityId: id,
      });
    });
    return { enabled };
  });
}
