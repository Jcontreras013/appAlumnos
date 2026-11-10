import { type AccessClaims, notFound } from "@escolar/service-kit";
import {
  type AssignmentDto,
  addDays,
  DEFAULT_PLAN_TEMPLATE,
  type LessonPlanDto,
  type PlanBoardDto,
  type PlanBoardRowDto,
  type PlanHistoryDto,
  type PlanStatus,
  type PlanTemplateDto,
} from "@escolar/shared";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  lessonPlans,
  planEvents,
  planTemplates,
  sections,
  substitutions,
  teacherLeaves,
  teachingAssignments,
} from "../db/schema";
import { listAssignments } from "./queries";

type PlanRow = typeof lessonPlans.$inferSelect;

/** Plantilla del centro, o la del Currículo Nacional Básico si todavía no definió una. */
export async function templateOf(db: DbOrTx, schoolId: string): Promise<PlanTemplateDto> {
  const [row] = await db.select().from(planTemplates).where(eq(planTemplates.schoolId, schoolId));
  if (!row) return { ...DEFAULT_PLAN_TEMPLATE, isDefault: true, updatedAt: null };
  return {
    fields: row.fields,
    deadlineDaysBefore: row.deadlineDaysBefore,
    isDefault: false,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fecha límite para entregar la planificación de una semana (p. ej. el viernes anterior). */
export const deadlineOf = (weekStart: string, daysBefore: number) => addDays(weekStart, -daysBefore);

export async function assignmentById(db: DbOrTx, schoolId: string, id: string): Promise<AssignmentDto> {
  const [row] = await db
    .select({ schoolYearId: sections.schoolYearId })
    .from(teachingAssignments)
    .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
    .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, id)));
  const assignment = row
    ? (await listAssignments(db, schoolId, { schoolYearId: row.schoolYearId })).find((a) => a.id === id)
    : undefined;
  if (!assignment) throw notFound("Clase no encontrada");
  return assignment;
}

/** Clases que alguien cubre como sustituto en algún día (lunes a viernes) de esa semana. */
export async function coveredDuringWeek(db: DbOrTx, schoolId: string, userId: string, weekStart: string) {
  const rows = await db
    .select({ assignmentId: substitutions.assignmentId })
    .from(substitutions)
    .innerJoin(teacherLeaves, eq(teacherLeaves.id, substitutions.leaveId))
    .where(
      and(
        eq(substitutions.schoolId, schoolId),
        eq(substitutions.substituteUserId, userId),
        isNull(substitutions.cancelledAt),
        isNull(teacherLeaves.cancelledAt),
        lte(substitutions.startsOn, addDays(weekStart, 4)),
        gte(substitutions.endsOn, weekStart),
      ),
    );
  return new Set(rows.map((r) => r.assignmentId));
}

/**
 * ¿Puede escribir la planificación de esta clase para esa semana? El maestro titular y, si está de
 * licencia, quien lo cubre esa semana. La dirección y coordinación revisan; no escriben por otros.
 */
export async function canAuthor(
  db: DbOrTx,
  auth: AccessClaims,
  assignment: Pick<AssignmentDto, "id" | "teacherUserId">,
  weekStart: string,
): Promise<boolean> {
  if (!auth.schoolId) return false;
  if (assignment.teacherUserId === auth.userId) return true;
  return (await coveredDuringWeek(db, auth.schoolId, auth.userId, weekStart)).has(assignment.id);
}

export const canReview = (auth: AccessClaims) => auth.role === "admin" || auth.role === "coordinador";

export function toPlanDto(row: PlanRow, assignment: AssignmentDto, deadline: string): LessonPlanDto {
  return {
    id: row.id,
    assignment,
    weekStart: row.weekStart,
    status: row.status,
    fields: row.fields,
    content: row.content,
    version: row.version,
    deadline,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewerName: row.reviewerName,
    reviewComment: row.reviewComment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function planHistory(db: DbOrTx, planId: string): Promise<PlanHistoryDto[]> {
  const rows = await db
    .select()
    .from(planEvents)
    .where(eq(planEvents.planId, planId))
    .orderBy(asc(planEvents.createdAt));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actorName,
    comment: r.comment,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function recordEvent(
  db: DbOrTx,
  auth: AccessClaims,
  plan: Pick<PlanRow, "id" | "schoolId" | "version">,
  action: PlanHistoryDto["action"],
  comment: string | null = null,
) {
  await db.insert(planEvents).values({
    schoolId: plan.schoolId,
    planId: plan.id,
    action,
    actorUserId: auth.userId,
    actorName: auth.name,
    comment,
    version: plan.version,
  });
}

/** Estado de la planificación de cada clase en una semana (tablero de coordinación o del maestro). */
export async function weekBoard(
  db: DbOrTx,
  schoolId: string,
  assignments: AssignmentDto[],
  weekStart: string,
  today: string,
): Promise<PlanBoardDto> {
  const template = await templateOf(db, schoolId);
  const deadline = deadlineOf(weekStart, template.deadlineDaysBefore);
  const plans = assignments.length
    ? await db
        .select({
          id: lessonPlans.id,
          assignmentId: lessonPlans.assignmentId,
          status: lessonPlans.status,
          submittedAt: lessonPlans.submittedAt,
        })
        .from(lessonPlans)
        .where(
          and(
            eq(lessonPlans.schoolId, schoolId),
            eq(lessonPlans.weekStart, weekStart),
            inArray(
              lessonPlans.assignmentId,
              assignments.map((a) => a.id),
            ),
          ),
        )
    : [];
  const totals: PlanBoardDto["totals"] = {
    sin_iniciar: 0,
    borrador: 0,
    enviada: 0,
    devuelta: 0,
    aprobada: 0,
    atrasadas: 0,
  };
  const rows: PlanBoardRowDto[] = assignments.map((assignment) => {
    const plan = plans.find((p) => p.assignmentId === assignment.id);
    const status: PlanStatus | "sin_iniciar" = plan?.status ?? "sin_iniciar";
    const overdue = !plan?.submittedAt && today > deadline;
    totals[status]++;
    if (overdue) totals.atrasadas++;
    return {
      assignment,
      planId: plan?.id ?? null,
      status,
      submittedAt: plan?.submittedAt?.toISOString() ?? null,
      overdue,
    };
  });
  return { weekStart, deadline, rows, totals };
}
