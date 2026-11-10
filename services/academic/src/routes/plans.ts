import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  createPlanInputSchema,
  formatDay,
  type LessonPlanDto,
  missingRequiredFields,
  mondayOf,
  type PlanBoardDto,
  type PlanDetailDto,
  type PlanTemplateDto,
  parsePlanContent,
  planTemplateInputSchema,
  reviewPlanInputSchema,
  savePlanInputSchema,
  weekStartSchema,
} from "@escolar/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { lessonPlans, planTemplates } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import {
  assignmentById,
  canAuthor,
  canReview,
  coveredDuringWeek,
  deadlineOf,
  planHistory,
  recordEvent,
  templateOf,
  toPlanDto,
  weekBoard,
} from "../lib/plans";
import { listAssignments, requireCurrentYear } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const weekQuery = z.object({ semana: weekStartSchema.optional() });
const STAFF = ["admin", "coordinador", "secretaria", "docente"] as const;

/**
 * Planificación semanal: el maestro (o su sustituto) llena la plantilla del centro para cada clase y
 * la envía antes de la fecha límite; la dirección o coordinación la aprueba o la devuelve con
 * observaciones. Cada paso queda en el historial.
 */
export async function planRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const staff = { preHandler: [app.authenticate, requireRole(...STAFF)] };
  const managers = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };
  const office = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };

  async function loadPlan(tx: DbOrTx, request: FastifyRequest, id: string) {
    const schoolId = tenantOf(request);
    const [row] = await tx
      .select()
      .from(lessonPlans)
      .where(and(eq(lessonPlans.schoolId, schoolId), eq(lessonPlans.id, id)));
    if (!row) throw notFound("Planificación no encontrada");
    const assignment = await assignmentById(tx, schoolId, row.assignmentId);
    const author = await canAuthor(tx, request.auth, assignment, row.weekStart);
    // Un maestro solo ve las planificaciones de las clases que da (o cubre esa semana).
    if (request.auth.role === "docente" && !author) throw notFound("Planificación no encontrada");
    return { row, assignment, author };
  }

  async function detail(tx: DbOrTx, request: FastifyRequest, id: string): Promise<PlanDetailDto> {
    const { row, assignment, author } = await loadPlan(tx, request, id);
    const template = await templateOf(tx, row.schoolId);
    return {
      plan: toPlanDto(row, assignment, deadlineOf(row.weekStart, template.deadlineDaysBefore)),
      history: await planHistory(tx, row.id),
      canEdit: author && (row.status === "borrador" || row.status === "devuelta"),
      canReview: canReview(request.auth) && row.status === "enviada",
    };
  }

  /** Guarda el contenido si la versión coincide (otra ventana pudo haber guardado antes). */
  async function saveContent(
    tx: DbOrTx,
    request: FastifyRequest,
    id: string,
    input: { content: Record<string, unknown>; version?: number },
  ) {
    const { row, author } = await loadPlan(tx, request, id);
    if (!author) throw forbidden("Solo quien da la clase puede escribir su planificación");
    if (row.status === "enviada") throw conflict("Ya se envió a revisión; espera la respuesta para editarla");
    if (row.status === "aprobada") throw conflict("La planificación ya fue aprobada");
    if (input.version !== undefined && input.version !== row.version) {
      throw conflict(
        "Alguien guardó esta planificación desde otra ventana. Recarga la página para ver lo último.",
      );
    }
    const { content, errors } = parsePlanContent(row.fields, input.content);
    if (Object.keys(errors).length) {
      throw badRequest("Revisa los campos marcados", {
        fields: Object.entries(errors).map(([path, message]) => ({ path, message })),
      });
    }
    const [saved] = await tx
      .update(lessonPlans)
      .set({ content, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(lessonPlans.id, row.id), eq(lessonPlans.version, row.version)))
      .returning();
    if (!saved) throw conflict("Alguien guardó esta planificación al mismo tiempo. Recarga la página.");
    await recordEvent(tx, request.auth, saved, "guardada");
    return saved;
  }

  // ── Plantilla ──
  app.get(
    "/plan-template",
    staff,
    async (request): Promise<PlanTemplateDto> => templateOf(db, tenantOf(request)),
  );

  app.put("/plan-template", managers, async (request): Promise<PlanTemplateDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(planTemplateInputSchema, request.body);
    await db
      .insert(planTemplates)
      .values({ schoolId, ...input, updatedByUserId: request.auth.userId })
      .onConflictDoUpdate({
        target: planTemplates.schoolId,
        set: { ...input, updatedByUserId: request.auth.userId, updatedAt: new Date() },
      });
    await audit(db, request, { action: "plan_template.updated", data: { fields: input.fields.length } });
    return templateOf(db, schoolId);
  });

  // ── Semana del maestro y tablero de coordinación ──
  app.get("/plans/mine", staff, async (request): Promise<PlanBoardDto> => {
    const schoolId = tenantOf(request);
    const { semana } = parseOrThrow(weekQuery, request.query);
    const weekStart = semana ?? mondayOf(today());
    const year = await requireCurrentYear(db, schoolId);
    const covered = await coveredDuringWeek(db, schoolId, request.auth.userId, weekStart);
    const mine = (await listAssignments(db, schoolId, { schoolYearId: year.id })).filter(
      (a) => a.teacherUserId === request.auth.userId || covered.has(a.id),
    );
    return weekBoard(db, schoolId, mine, weekStart, today());
  });

  app.get("/plans/board", office, async (request): Promise<PlanBoardDto> => {
    const schoolId = tenantOf(request);
    const { semana } = parseOrThrow(weekQuery, request.query);
    const year = await requireCurrentYear(db, schoolId);
    const assignments = await listAssignments(db, schoolId, { schoolYearId: year.id });
    return weekBoard(db, schoolId, assignments, semana ?? mondayOf(today()), today());
  });

  // ── Una planificación ──
  /** Crea la planificación (o devuelve la que ya existe: un doble clic no la duplica). */
  app.post("/plans", staff, async (request, reply): Promise<PlanDetailDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(createPlanInputSchema, request.body);
    const year = await requireCurrentYear(db, schoolId);
    const assignment = await assignmentById(db, schoolId, input.assignmentId);
    if (assignment.schoolYearId !== year.id) throw badRequest("Esa clase no es del año lectivo vigente");
    if (input.weekStart < mondayOf(year.startsOn) || input.weekStart > year.endsOn) {
      throw badRequest(
        `La semana está fuera del año lectivo (${formatDay(year.startsOn)} a ${formatDay(year.endsOn)})`,
      );
    }
    if (!(await canAuthor(db, request.auth, assignment, input.weekStart))) {
      throw forbidden("Solo quien da la clase (o la cubre esa semana) puede planificarla");
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: lessonPlans.id })
        .from(lessonPlans)
        .where(and(eq(lessonPlans.assignmentId, assignment.id), eq(lessonPlans.weekStart, input.weekStart)));
      if (existing) return { id: existing.id, created: false };

      const template = await templateOf(tx, schoolId);
      let content = {};
      let comment: string | null = null;
      if (input.copyFromPlanId) {
        const [source] = await tx
          .select()
          .from(lessonPlans)
          .where(and(eq(lessonPlans.schoolId, schoolId), eq(lessonPlans.id, input.copyFromPlanId)));
        const sourceAssignment = source ? await assignmentById(tx, schoolId, source.assignmentId) : null;
        if (
          !source ||
          !sourceAssignment ||
          (source.authorUserId !== request.auth.userId &&
            sourceAssignment.teacherUserId !== request.auth.userId)
        ) {
          throw notFound("No se encontró la planificación a copiar");
        }
        content = parsePlanContent(template.fields, source.content).content;
        comment = `Copiada de ${sourceAssignment.subjectName}, semana del ${formatDay(source.weekStart)}`;
      }
      const [row] = await tx
        .insert(lessonPlans)
        .values({
          schoolId,
          assignmentId: assignment.id,
          weekStart: input.weekStart,
          fields: template.fields,
          content,
          authorUserId: request.auth.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        // Otra petición la creó en el mismo instante.
        const [again] = await tx
          .select({ id: lessonPlans.id })
          .from(lessonPlans)
          .where(
            and(eq(lessonPlans.assignmentId, assignment.id), eq(lessonPlans.weekStart, input.weekStart)),
          );
        return { id: again?.id as string, created: false };
      }
      await recordEvent(tx, request.auth, row, "creada", comment);
      return { id: row.id, created: true };
    });
    reply.status(result.created ? 201 : 200);
    return detail(db, request, result.id);
  });

  app.get("/plans/:id", staff, async (request): Promise<PlanDetailDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return detail(db, request, id);
  });

  app.put("/plans/:id", staff, async (request): Promise<PlanDetailDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(savePlanInputSchema, request.body);
    await db.transaction((tx) => saveContent(tx, request, id, input));
    return detail(db, request, id);
  });

  /** Envía a revisión (si trae contenido, primero lo guarda). Exige los campos obligatorios. */
  app.post("/plans/:id/submit", staff, async (request): Promise<PlanDetailDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(savePlanInputSchema.partial(), request.body ?? {});
    await db.transaction(async (tx) => {
      const { row: current, author } = await loadPlan(tx, request, id);
      if (!author) throw forbidden("Solo quien da la clase puede enviar su planificación");
      const row = input.content
        ? await saveContent(tx, request, id, { content: input.content, version: input.version })
        : current;
      if (row.status !== "borrador" && row.status !== "devuelta") {
        throw conflict(row.status === "aprobada" ? "Ya fue aprobada" : "Ya está en revisión");
      }
      const missing = missingRequiredFields(row.fields, row.content);
      if (missing.length) {
        throw badRequest(`Faltan campos obligatorios: ${missing.map((f) => f.label).join(", ")}`, {
          fields: missing.map((f) => ({ path: f.key, message: "Este campo es obligatorio" })),
        });
      }
      const [sent] = await tx
        .update(lessonPlans)
        .set({ status: "enviada", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(lessonPlans.id, row.id))
        .returning();
      if (sent) await recordEvent(tx, request.auth, sent, "enviada");
    });
    return detail(db, request, id);
  });

  app.post("/plans/:id/review", managers, async (request): Promise<PlanDetailDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(reviewPlanInputSchema, request.body);
    await db.transaction(async (tx) => {
      const { row } = await loadPlan(tx, request, id);
      if (row.status !== "enviada") throw conflict("Solo se revisan planificaciones enviadas");
      const approved = input.decision === "aprobar";
      const [reviewed] = await tx
        .update(lessonPlans)
        .set({
          status: approved ? "aprobada" : "devuelta",
          reviewedAt: new Date(),
          reviewerUserId: request.auth.userId,
          reviewerName: request.auth.name,
          reviewComment: input.comment || null,
          updatedAt: new Date(),
        })
        .where(eq(lessonPlans.id, row.id))
        .returning();
      if (reviewed) {
        await recordEvent(
          tx,
          request.auth,
          reviewed,
          approved ? "aprobada" : "devuelta",
          input.comment || null,
        );
      }
    });
    return detail(db, request, id);
  });

  /** Planificaciones recientes del maestro (de cualquiera de sus clases), para copiar de ellas. */
  app.get("/plans/recent", staff, async (request): Promise<LessonPlanDto[]> => {
    const schoolId = tenantOf(request);
    const me = request.auth.userId;
    const year = await requireCurrentYear(db, schoolId);
    const assignments = await listAssignments(db, schoolId, { schoolYearId: year.id });
    const rows = assignments.length
      ? await db
          .select()
          .from(lessonPlans)
          .where(
            and(
              eq(lessonPlans.schoolId, schoolId),
              inArray(
                lessonPlans.assignmentId,
                assignments.map((a) => a.id),
              ),
            ),
          )
      : [];
    const template = await templateOf(db, schoolId);
    return rows
      .map((r) => ({ r, assignment: assignments.find((a) => a.id === r.assignmentId) }))
      .filter(({ r, assignment }) => assignment && (r.authorUserId === me || assignment.teacherUserId === me))
      .sort((a, b) => b.r.weekStart.localeCompare(a.r.weekStart))
      .slice(0, 15)
      .map(({ r, assignment }) =>
        toPlanDto(
          r,
          assignment as NonNullable<typeof assignment>,
          deadlineOf(r.weekStart, template.deadlineDaysBefore),
        ),
      );
  });
}
