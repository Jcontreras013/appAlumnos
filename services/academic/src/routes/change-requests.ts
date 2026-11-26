import { ApiError, conflict, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type ChangeRequestDto,
  type ChangeRequestKind,
  changeRequestInputSchema,
  formatDay,
  gradeInputSchema,
  LEAVE_TYPE_LABELS,
  leaveInputSchema,
  rejectChangeRequestSchema,
  sectionInputSchema,
  subjectInputSchema,
} from "@escolar/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { type ChangeRequest, changeRequests, grades, schoolYears } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { requireTeacher } from "../lib/staff";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ estado: z.enum(["pendiente", "todas"]).default("todas") });

/** Dónde se crea cada cosa al confirmarla (la misma ruta que usa la dirección en su pantalla). */
const TARGET: Record<ChangeRequestKind, string> = {
  grado: "/grades",
  seccion: "/sections",
  materia: "/subjects",
  licencia: "/leaves",
};

const toDto = (r: ChangeRequest): ChangeRequestDto => ({
  id: r.id,
  kind: r.kind as ChangeRequestKind,
  summary: r.summary,
  status: r.status as ChangeRequestDto["status"],
  requestedByName: r.requestedByName,
  createdAt: r.createdAt.toISOString(),
  decidedByName: r.decidedByName,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  decisionNote: r.decisionNote,
});

/**
 * La secretaría pide crear grados, secciones y materias, o registrar el permiso de un maestro; la
 * dirección lo confirma (y entonces se crea) o lo rechaza. Así la dirección decide, pero no tiene que
 * llenar ella los formularios.
 */
export async function changeRequestRoutes(app: FastifyInstance, { db, identity }: AcademicDeps) {
  const secretary = { preHandler: [app.authenticate, requireRole("secretaria")] };
  const director = { preHandler: [app.authenticate, requireRole("admin")] };
  const both = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };

  /** Valida los datos con el mismo esquema del formulario y los describe en palabras. */
  async function describe(
    request: FastifyRequest,
    kind: ChangeRequestKind,
    raw: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown>; summary: string }> {
    const schoolId = tenantOf(request);
    if (kind === "grado") {
      const payload = parseOrThrow(gradeInputSchema, raw);
      return { payload, summary: `Crear el grado «${payload.name}»` };
    }
    if (kind === "materia") {
      const payload = parseOrThrow(subjectInputSchema, raw);
      return { payload, summary: `Crear la materia «${payload.name}»` };
    }
    if (kind === "seccion") {
      const payload = parseOrThrow(sectionInputSchema, raw);
      const [grade] = await db
        .select({ name: grades.name })
        .from(grades)
        .where(and(eq(grades.schoolId, schoolId), eq(grades.id, payload.gradeId)));
      const [year] = await db
        .select({ name: schoolYears.name })
        .from(schoolYears)
        .where(and(eq(schoolYears.schoolId, schoolId), eq(schoolYears.id, payload.schoolYearId)));
      if (!grade) throw notFound("Grado no encontrado");
      if (!year) throw notFound("Año lectivo no encontrado");
      const capacity = payload.capacity ? ` (cupo de ${payload.capacity})` : "";
      return {
        payload,
        summary: `Crear la sección ${payload.name} de ${grade.name}, año ${year.name}${capacity}`,
      };
    }
    const payload = parseOrThrow(leaveInputSchema, raw);
    const teacher = await requireTeacher(identity, request, payload.teacherUserId);
    const days =
      payload.startsOn === payload.endsOn
        ? `el ${formatDay(payload.startsOn)}`
        : `del ${formatDay(payload.startsOn)} al ${formatDay(payload.endsOn)}`;
    return {
      payload,
      summary: `Registrar el permiso de ${teacher.name} (${LEAVE_TYPE_LABELS[payload.type].toLowerCase()}) ${days}`,
    };
  }

  app.post("/change-requests", secretary, async (request, reply): Promise<ChangeRequestDto> => {
    const { kind, payload: raw } = parseOrThrow(changeRequestInputSchema, request.body);
    const { payload, summary } = await describe(request, kind, raw);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(changeRequests)
        .values({
          schoolId: tenantOf(request),
          kind,
          payload,
          summary,
          requestedByUserId: request.auth.userId,
          requestedByName: request.auth.name,
        })
        .returning();
      if (!created) throw new Error("No se guardó la solicitud");
      await audit(tx, request, {
        action: "change_request.created",
        entityType: "change_request",
        entityId: created.id,
        data: { kind, summary },
      });
      return created;
    });
    return reply.status(201).send(toDto(row));
  });

  /** La dirección ve todas; la secretaría, las suyas. Primero las que esperan confirmación. */
  app.get("/change-requests", both, async (request): Promise<ChangeRequestDto[]> => {
    const { estado } = parseOrThrow(listQuery, request.query);
    const rows = await db
      .select()
      .from(changeRequests)
      .where(
        and(
          eq(changeRequests.schoolId, tenantOf(request)),
          request.auth.role === "secretaria"
            ? eq(changeRequests.requestedByUserId, request.auth.userId)
            : undefined,
          estado === "pendiente" ? eq(changeRequests.status, "pendiente") : undefined,
        ),
      )
      .orderBy(sql`${changeRequests.status} = 'pendiente' desc`, desc(changeRequests.createdAt))
      .limit(100);
    return rows.map(toDto);
  });

  /** Cuántas esperan a la dirección (para el aviso del menú). */
  app.get("/change-requests/pending-count", director, async (request) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeRequests)
      .where(and(eq(changeRequests.schoolId, tenantOf(request)), eq(changeRequests.status, "pendiente")));
    return { count: row?.count ?? 0 };
  });

  async function pending(request: FastifyRequest, id: string) {
    const [row] = await db
      .select()
      .from(changeRequests)
      .where(and(eq(changeRequests.schoolId, tenantOf(request)), eq(changeRequests.id, id)));
    if (!row) throw notFound("Solicitud no encontrada");
    if (row.status !== "pendiente") throw conflict("Esa solicitud ya se respondió");
    return row;
  }

  /**
   * Confirmar: se crea lo pedido por la misma ruta que usa la dirección (con sus mismas reglas: un
   * grado repetido, una licencia que se cruza con otra…). Si no se puede, la solicitud sigue pendiente
   * y la dirección ve por qué.
   */
  app.post("/change-requests/:id/approve", director, async (request): Promise<ChangeRequestDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const row = await pending(request, id);
    const res = await app.inject({
      method: "POST",
      url: TARGET[row.kind as ChangeRequestKind],
      payload: row.payload,
      headers: { authorization: request.headers.authorization ?? "" },
    });
    if (res.statusCode >= 400) {
      const body = res.json<{ error?: { code?: string; message?: string; details?: unknown } }>();
      throw new ApiError(
        res.statusCode,
        body.error?.code ?? "no_se_pudo",
        body.error?.message ?? "No se pudo aplicar la solicitud",
        body.error?.details,
      );
    }
    const resultId = (res.json<{ id?: string; leave?: { id?: string } }>().id ?? null) as string | null;
    const [updated] = await db.transaction(async (tx) => {
      const done = await tx
        .update(changeRequests)
        .set({
          status: "aprobada",
          decidedByUserId: request.auth.userId,
          decidedByName: request.auth.name,
          decidedAt: new Date(),
          resultId,
        })
        .where(and(eq(changeRequests.id, row.id), eq(changeRequests.status, "pendiente")))
        .returning();
      await audit(tx, request, {
        action: "change_request.approved",
        entityType: "change_request",
        entityId: row.id,
        data: { kind: row.kind, summary: row.summary, requestedBy: row.requestedByName },
      });
      return done;
    });
    if (!updated) throw conflict("Esa solicitud ya se respondió");
    return toDto(updated);
  });

  app.post("/change-requests/:id/reject", director, async (request): Promise<ChangeRequestDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { note } = parseOrThrow(rejectChangeRequestSchema, request.body ?? {});
    const row = await pending(request, id);
    const [updated] = await db.transaction(async (tx) => {
      const done = await tx
        .update(changeRequests)
        .set({
          status: "rechazada",
          decidedByUserId: request.auth.userId,
          decidedByName: request.auth.name,
          decidedAt: new Date(),
          decisionNote: note || null,
        })
        .where(and(eq(changeRequests.id, row.id), eq(changeRequests.status, "pendiente")))
        .returning();
      await audit(tx, request, {
        action: "change_request.rejected",
        entityType: "change_request",
        entityId: row.id,
        data: { kind: row.kind, summary: row.summary, requestedBy: row.requestedByName },
      });
      return done;
    });
    if (!updated) throw conflict("Esa solicitud ya se respondió");
    return toDto(updated);
  });
}
