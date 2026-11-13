import { badRequest, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import { type AnnouncementDto, addDays, announcementInputSchema, isIsoDate } from "@escolar/shared";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { type Announcement, announcements, enrollments, grades, sections } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { childrenOf } from "../lib/family";
import { findCurrentYear, sectionLabel } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
/** Si no se dice hasta cuándo, el aviso se muestra 30 días. */
const DEFAULT_DAYS = 30;

/**
 * Avisos del centro: reuniones, suspensión de clases, entrega de boletas… La dirección, coordinación
 * y secretaría los publican; el personal y las familias los ven en el panel mientras están vigentes.
 */
export async function announcementRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const publishers = ["admin", "coordinador", "secretaria"] as const;
  const staff = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const write = { preHandler: [app.authenticate, requireRole(...publishers)] };
  const family = { preHandler: [app.authenticate, requireRole("padre")] };

  async function list(schoolId: string, where: ReturnType<typeof and>, request: FastifyRequest) {
    const rows = await db
      .select({ a: announcements, sectionName: sections.name, gradeName: grades.name })
      .from(announcements)
      .leftJoin(sections, eq(sections.id, announcements.sectionId))
      .leftJoin(grades, eq(grades.id, sections.gradeId))
      .where(and(eq(announcements.schoolId, schoolId), where))
      .orderBy(desc(announcements.createdAt))
      .limit(100);
    return rows.map(({ a, sectionName, gradeName }) => toDto(request, a, sectionName, gradeName));
  }

  const toDto = (
    request: FastifyRequest,
    a: Announcement,
    sectionName: string | null,
    gradeName: string | null,
  ): AnnouncementDto => ({
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience,
    sectionId: a.sectionId,
    sectionLabel: sectionName && gradeName ? sectionLabel(gradeName, sectionName) : null,
    authorName: a.authorName,
    createdAt: a.createdAt.toISOString(),
    expiresOn: a.expiresOn,
    canDelete: request.auth.role === "admin" || a.authorUserId === request.auth.userId,
  });

  /** Personal: los vigentes para el personal. Quien publica ve también los vencidos del último mes. */
  app.get("/announcements", staff, async (request): Promise<AnnouncementDto[]> => {
    const schoolId = tenantOf(request);
    const publisher = (publishers as readonly string[]).includes(request.auth.role);
    return list(
      schoolId,
      publisher
        ? gte(announcements.expiresOn, addDays(today(), -30))
        : and(gte(announcements.expiresOn, today()), inArray(announcements.audience, ["todos", "personal"])),
      request,
    );
  });

  /** Familias: los vigentes para familias, del centro o de la sección de alguno de sus hijos. */
  app.get("/family/announcements", family, async (request): Promise<AnnouncementDto[]> => {
    const schoolId = tenantOf(request);
    const kids = await childrenOf(db, schoolId, request.auth.userId);
    const year = await findCurrentYear(db, schoolId);
    const sectionIds =
      kids.length && year
        ? (
            await db
              .select({ sectionId: enrollments.sectionId })
              .from(enrollments)
              .where(
                and(
                  eq(enrollments.schoolId, schoolId),
                  eq(enrollments.schoolYearId, year.id),
                  eq(enrollments.status, "activa"),
                  inArray(enrollments.studentId, kids),
                ),
              )
          ).map((e) => e.sectionId)
        : [];
    return list(
      schoolId,
      and(
        gte(announcements.expiresOn, today()),
        inArray(announcements.audience, ["todos", "familias"]),
        sectionIds.length
          ? or(isNull(announcements.sectionId), inArray(announcements.sectionId, sectionIds))
          : isNull(announcements.sectionId),
      ),
      request,
    );
  });

  app.post("/announcements", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(announcementInputSchema, request.body);
    const expiresOn = input.expiresOn ?? addDays(today(), DEFAULT_DAYS);
    if (!isIsoDate(expiresOn) || expiresOn < today()) {
      throw badRequest("La fecha de vencimiento ya pasó", {
        fields: [{ path: "expiresOn", message: "Debe ser hoy o después" }],
      });
    }
    if (input.sectionId) {
      const [section] = await db
        .select({ id: sections.id })
        .from(sections)
        .where(and(eq(sections.schoolId, schoolId), eq(sections.id, input.sectionId)));
      if (!section) throw notFound("Sección no encontrada");
    }
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(announcements)
        .values({
          schoolId,
          title: input.title,
          body: input.body,
          audience: input.audience,
          sectionId: input.sectionId ?? null,
          expiresOn,
          authorUserId: request.auth.userId,
          authorName: request.auth.name,
        })
        .returning();
      if (!row) throw new Error("No se publicó el aviso");
      await audit(tx, request, {
        action: "announcement.published",
        entityType: "announcement",
        entityId: row.id,
        data: { title: row.title, audience: row.audience },
      });
      return row;
    });
    const [dto] = (await list(schoolId, eq(announcements.id, created.id), request)) as [AnnouncementDto];
    return reply.status(201).send(dto);
  });

  app.delete("/announcements/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.schoolId, schoolId), eq(announcements.id, id)));
    if (!row) throw notFound("Aviso no encontrado");
    if (request.auth.role !== "admin" && row.authorUserId !== request.auth.userId) {
      throw forbidden("Solo quien lo publicó o la dirección lo puede quitar");
    }
    await db.transaction(async (tx) => {
      await tx.delete(announcements).where(eq(announcements.id, id));
      await audit(tx, request, {
        action: "announcement.removed",
        entityType: "announcement",
        entityId: id,
        data: { title: row.title },
      });
    });
    return reply.status(204).send();
  });
}
