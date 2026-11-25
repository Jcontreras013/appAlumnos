import { conflict, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type ClassChatDto,
  type ClassChatMessageDto,
  classChatInputSchema,
  classChatStatusSchema,
} from "@escolar/shared";
import { and, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { type ClassChatMessage, classChatMessages, virtualClasses } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { type ClassAccess, classAccess } from "../lib/classroom";

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
