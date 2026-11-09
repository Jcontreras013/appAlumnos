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
  type ActivityInput,
  type AttendanceSheetDto,
  activityInputSchema,
  attendanceInputSchema,
  currentPeriod,
  type GradebookDto,
  type GradingPeriodDto,
  isIsoDate,
  periodGrade,
  periodsInputSchema,
  type SchoolFollowUpDto,
  scoresInputSchema,
  type TeacherClassDto,
} from "@escolar/shared";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import {
  activities,
  attendanceRecords,
  evaluationSettings,
  gradingPeriods,
  schoolYears,
  scores,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import {
  attendanceSheet,
  canGrade,
  canTakeAttendance,
  ensureDefaultPeriods,
  followUp,
  gradebook,
  listPeriods,
  passingGradeOf,
  rosterOf,
  teacherClasses,
} from "../lib/evaluation";
import { findCurrentYear, getSection, listAssignments, requireCurrentYear } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const periodQuery = z.object({ periodId: z.uuid().optional() });
const dateQuery = z.object({ fecha: z.string().refine(isIsoDate).optional() });

const STAFF = ["admin", "coordinador", "secretaria", "docente"] as const;

async function assignmentOrThrow(db: DbOrTx, schoolId: string, assignmentId: string) {
  const year = await findCurrentYear(db, schoolId);
  const assignment = year
    ? (await listAssignments(db, schoolId, { schoolYearId: year.id })).find((a) => a.id === assignmentId)
    : undefined;
  if (!assignment) throw notFound("Clase no encontrada");
  return { assignment, year: year as NonNullable<typeof year> };
}

async function periodsFor(db: DbOrTx, schoolId: string) {
  const year = await requireCurrentYear(db, schoolId);
  const periods = await ensureDefaultPeriods(db, year);
  return { year, periods };
}

/**
 * Cuaderno del maestro: notas por actividad y asistencia diaria, pensado para registrarse durante
 * el parcial (y sin internet, desde el panel) y pasar al SACE al cierre ya completo.
 */
export async function evaluationRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const staff = { preHandler: [app.authenticate, requireRole(...STAFF)] };
  const managers = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };
  const office = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };

  // ── Parciales y nota mínima ──
  app.get(
    "/periods",
    staff,
    async (
      request,
    ): Promise<{ periods: GradingPeriodDto[]; current: string | null; passingGrade: number }> => {
      const schoolId = tenantOf(request);
      const { periods } = await periodsFor(db, schoolId);
      return {
        periods,
        current: currentPeriod(periods, today())?.id ?? null,
        passingGrade: await passingGradeOf(db, schoolId),
      };
    },
  );

  app.put("/periods", managers, async (request): Promise<GradingPeriodDto[]> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(periodsInputSchema, request.body);
    const year = await requireCurrentYear(db, schoolId);
    if (
      (input.periods[0]?.startsOn ?? "") < year.startsOn ||
      (input.periods.at(-1)?.endsOn ?? "") > year.endsOn
    ) {
      throw badRequest(
        `Los parciales deben estar dentro del año lectivo (${year.startsOn} a ${year.endsOn})`,
      );
    }
    await db.transaction(async (tx) => {
      const existing = await listPeriods(tx, schoolId, year.id);
      // Quitar parciales que ya tienen notas borraría esas notas: no se permite.
      const removed = existing.filter((p) => p.number > input.periods.length);
      if (removed.length) {
        const used = await tx
          .select({ id: activities.id })
          .from(activities)
          .where(
            inArray(
              activities.periodId,
              removed.map((p) => p.id),
            ),
          )
          .limit(1);
        if (used.length) throw conflict("No se puede quitar un parcial que ya tiene notas registradas");
        await tx
          .delete(gradingPeriods)
          .where(
            and(eq(gradingPeriods.schoolYearId, year.id), gt(gradingPeriods.number, input.periods.length)),
          );
      }
      for (const [i, p] of input.periods.entries()) {
        const current = existing.find((e) => e.number === i + 1);
        if (current) await tx.update(gradingPeriods).set(p).where(eq(gradingPeriods.id, current.id));
        else await tx.insert(gradingPeriods).values({ schoolId, schoolYearId: year.id, number: i + 1, ...p });
      }
      await audit(tx, request, { action: "periods.updated", entityType: "school_year", entityId: year.id });
    });
    return listPeriods(db, schoolId, year.id);
  });

  app.put("/evaluation-settings", managers, async (request) => {
    const schoolId = tenantOf(request);
    const { passingGrade } = parseOrThrow(
      z.object({ passingGrade: z.coerce.number().int().min(1).max(100) }),
      request.body,
    );
    await db
      .insert(evaluationSettings)
      .values({ schoolId, passingGrade })
      .onConflictDoUpdate({
        target: evaluationSettings.schoolId,
        set: { passingGrade, updatedAt: new Date() },
      });
    await audit(db, request, { action: "evaluation.passing_grade", data: { passingGrade } });
    return { passingGrade };
  });

  // ── Mis clases ──
  app.get(
    "/teacher/classes",
    staff,
    async (request): Promise<TeacherClassDto[]> =>
      teacherClasses(db, tenantOf(request), request.auth.userId, today()),
  );

  // ── Cuaderno de notas ──
  app.get("/gradebook/:id", staff, async (request): Promise<GradebookDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { periodId } = parseOrThrow(periodQuery, request.query);
    const { assignment } = await assignmentOrThrow(db, schoolId, id);
    const editable = await canGrade(db, request.auth, assignment, today());
    // Un docente solo ve el cuaderno de las clases que da (o cubre); la oficina, todas.
    if (request.auth.role === "docente" && !editable) throw notFound("Clase no encontrada");
    const { periods } = await periodsFor(db, schoolId);
    const period = periods.find((p) => p.id === periodId) ?? currentPeriod(periods, today());
    if (!period) throw notFound("El año no tiene parciales");
    return gradebook(db, schoolId, assignment, periods, period, editable);
  });

  /** Crear o actualizar una actividad. El id viene del dispositivo (sincronización sin duplicados). */
  app.put("/activities/:id", staff, async (request): Promise<{ id: string }> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input: ActivityInput = parseOrThrow(activityInputSchema, request.body);
    if (input.id !== id) throw badRequest("El id no coincide");
    const { assignment, year } = await assignmentOrThrow(db, schoolId, input.assignmentId);
    if (!(await canGrade(db, request.auth, assignment, today()))) throw forbidden("No das esta clase");
    const [period] = await db
      .select()
      .from(gradingPeriods)
      .where(
        and(
          eq(gradingPeriods.schoolId, schoolId),
          eq(gradingPeriods.id, input.periodId),
          eq(gradingPeriods.schoolYearId, year.id),
        ),
      );
    if (!period) throw notFound("Parcial no encontrado");

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(activities)
        .where(and(eq(activities.schoolId, schoolId), eq(activities.id, id)));
      if (existing && existing.assignmentId !== assignment.id)
        throw conflict("Esa actividad es de otra clase");
      // Cada parcial vale 100 puntos: las actividades no pueden repartir más.
      const others = await tx
        .select({ id: activities.id, maxPoints: activities.maxPoints })
        .from(activities)
        .where(and(eq(activities.assignmentId, assignment.id), eq(activities.periodId, period.id)));
      const used = others.filter((a) => a.id !== id).reduce((acc, a) => acc + a.maxPoints, 0);
      if (used + input.maxPoints > 100) {
        throw conflict(
          `El parcial ya tiene ${used} puntos repartidos; a esta actividad le puedes dar hasta ${100 - used}`,
        );
      }
      if (existing) {
        const tooHigh = await tx
          .select({ points: scores.points })
          .from(scores)
          .where(and(eq(scores.activityId, id), gt(scores.points, input.maxPoints)))
          .limit(1);
        if (tooHigh.length) throw conflict("Hay notas mayores a ese valor; corrígelas antes de bajarlo");
        await tx
          .update(activities)
          .set({
            name: input.name,
            maxPoints: input.maxPoints,
            date: input.date,
            periodId: period.id,
            updatedAt: new Date(),
          })
          .where(eq(activities.id, id));
      } else {
        await tx.insert(activities).values({
          id,
          schoolId,
          assignmentId: assignment.id,
          periodId: period.id,
          name: input.name,
          maxPoints: input.maxPoints,
          date: input.date,
          createdByUserId: request.auth.userId,
        });
      }
    });
    return { id };
  });

  app.delete("/activities/:id", staff, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [activity] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.schoolId, schoolId), eq(activities.id, id)));
    // Borrar algo que ya no existe (p. ej. reintento sin internet) no es un error.
    if (!activity) return reply.status(204).send();
    const { assignment } = await assignmentOrThrow(db, schoolId, activity.assignmentId);
    if (!(await canGrade(db, request.auth, assignment, today()))) throw forbidden("No das esta clase");
    await db.transaction(async (tx) => {
      await tx.delete(activities).where(eq(activities.id, id));
      await audit(tx, request, {
        action: "activity.deleted",
        entityType: "activity",
        entityId: id,
        data: { name: activity.name, assignmentId: activity.assignmentId },
      });
    });
    return reply.status(204).send();
  });

  app.put("/scores", staff, async (request) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(scoresInputSchema, request.body);
    const [activity] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.schoolId, schoolId), eq(activities.id, input.activityId)));
    if (!activity) throw notFound("Actividad no encontrada");
    const { assignment } = await assignmentOrThrow(db, schoolId, activity.assignmentId);
    if (!(await canGrade(db, request.auth, assignment, today()))) throw forbidden("No das esta clase");

    const roster = new Set((await rosterOf(db, schoolId, [assignment.sectionId])).map((r) => r.studentId));
    for (const entry of input.entries) {
      if (!roster.has(entry.studentId))
        throw badRequest("Hay alumnos que no están matriculados en esta sección");
      if (entry.points !== null && entry.points > activity.maxPoints) {
        throw badRequest(`La nota máxima de "${activity.name}" es ${activity.maxPoints}`);
      }
    }
    await db.transaction(async (tx) => {
      for (const entry of input.entries) {
        await tx
          .insert(scores)
          .values({
            schoolId,
            activityId: activity.id,
            studentId: entry.studentId,
            points: entry.points,
            updatedByUserId: request.auth.userId,
          })
          .onConflictDoUpdate({
            target: [scores.activityId, scores.studentId],
            set: { points: entry.points, updatedByUserId: request.auth.userId, updatedAt: new Date() },
          });
      }
    });
    return { saved: input.entries.length };
  });

  // ── Asistencia ──
  app.get("/attendance/:id", staff, async (request): Promise<AttendanceSheetDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { fecha } = parseOrThrow(dateQuery, request.query);
    const date = fecha ?? today();
    const section = await getSection(db, schoolId, id);
    const editable = await canTakeAttendance(db, request.auth, section, date);
    if (request.auth.role === "docente" && !editable) throw notFound("Sección no encontrada");
    return attendanceSheet(db, schoolId, section, date, editable && date <= today());
  });

  app.put("/attendance", staff, async (request) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(attendanceInputSchema, request.body);
    if (input.date > today()) throw badRequest("No se puede tomar asistencia de un día que todavía no llega");
    const section = await getSection(db, schoolId, input.sectionId);
    const [year] = await db.select().from(schoolYears).where(eq(schoolYears.id, section.schoolYearId));
    if (year && (input.date < year.startsOn || input.date > year.endsOn)) {
      throw badRequest("La fecha está fuera del año lectivo");
    }
    if (!(await canTakeAttendance(db, request.auth, section, input.date))) {
      throw forbidden("No das clases en esta sección");
    }
    const roster = new Set((await rosterOf(db, schoolId, [section.id])).map((r) => r.studentId));
    if (input.entries.some((e) => !roster.has(e.studentId))) {
      throw badRequest("Hay alumnos que no están matriculados en esta sección");
    }
    await db.transaction(async (tx) => {
      for (const entry of input.entries) {
        await tx
          .insert(attendanceRecords)
          .values({
            schoolId,
            sectionId: section.id,
            date: input.date,
            studentId: entry.studentId,
            status: entry.status,
            recordedByUserId: request.auth.userId,
          })
          .onConflictDoUpdate({
            target: [attendanceRecords.sectionId, attendanceRecords.date, attendanceRecords.studentId],
            set: { status: entry.status, recordedByUserId: request.auth.userId, updatedAt: new Date() },
          });
      }
    });
    return { saved: input.entries.length };
  });

  // ── Seguimiento de la dirección ──
  app.get("/follow-up", office, async (request): Promise<SchoolFollowUpDto> => {
    const { fecha } = parseOrThrow(dateQuery, request.query);
    const schoolId = tenantOf(request);
    const year = await findCurrentYear(db, schoolId);
    if (year) await ensureDefaultPeriods(db, year);
    return followUp(db, schoolId, fecha ?? today());
  });

  /** Cuadro de calificaciones de una sección en un parcial (para pasar al SACE o imprimir). */
  app.get("/sections/:id/grades-report", office, async (request) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { periodId } = parseOrThrow(periodQuery, request.query);
    const section = await getSection(db, schoolId, id);
    const { periods } = await periodsFor(db, schoolId);
    const period = periods.find((p) => p.id === periodId) ?? currentPeriod(periods, today());
    if (!period) throw notFound("El año no tiene parciales");
    const assignments = (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId })).filter(
      (a) => a.sectionId === section.id,
    );
    const roster = await rosterOf(db, schoolId, [section.id]);
    const acts = assignments.length
      ? await db
          .select()
          .from(activities)
          .where(
            and(
              eq(activities.periodId, period.id),
              inArray(
                activities.assignmentId,
                assignments.map((a) => a.id),
              ),
            ),
          )
      : [];
    const marks = acts.length
      ? await db
          .select()
          .from(scores)
          .where(
            inArray(
              scores.activityId,
              acts.map((a) => a.id),
            ),
          )
      : [];
    return {
      section,
      period,
      passingGrade: await passingGradeOf(db, schoolId),
      subjects: assignments.map((a) => ({
        assignmentId: a.id,
        subjectName: a.subjectName,
        teacherName: a.teacherName,
      })),
      students: roster.map((r) => ({
        studentId: r.studentId,
        name: `${r.lastNames}, ${r.firstNames}`,
        nationalId: r.nationalId,
        grades: Object.fromEntries(
          assignments.map((a) => {
            const own = acts.filter((x) => x.assignmentId === a.id);
            const result = periodGrade(
              own,
              Object.fromEntries(
                own.map((x) => [
                  x.id,
                  marks.find((m) => m.activityId === x.id && m.studentId === r.studentId)?.points ?? null,
                ]),
              ),
            );
            return [a.id, { grade: result.grade, points: result.points, possible: result.possible }];
          }),
        ),
      })),
    };
  });
}
