import {
  addDays,
  currentPeriod,
  mondayOf,
  PILOT_INDICATORS,
  type PilotIndicator,
  type PilotMeasure,
  type PilotSchoolDto,
  RISK_RULES,
  type ScopedSchoolDto,
  todayInHonduras,
} from "@escolar/shared";
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  attendanceRecords,
  enrollments,
  guardians,
  scores,
  studentGuardians,
  substitutions,
  teacherLeaves,
} from "../db/schema";
import { listPeriods, rosterOf } from "./evaluation";
import { weekBoard } from "./plans";
import { findCurrentYear, listAssignments, listSections } from "./queries";

const none = (): PilotMeasure => ({ met: 0, total: 0 });

/** Días hábiles (lunes a viernes) entre dos fechas, inclusive. */
export function businessDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(d);
  }
  return days;
}

/** Una sección "pasa asistencia" si tiene lista en al menos 4 de cada 5 días hábiles. */
const ATTENDANCE_DAYS_SHARE = 0.8;

/**
 * Indicadores del piloto de un centro en un período. `activity` viene de identity (qué cuentas ya
 * se usan); el resto se mide con los datos del centro.
 */
export async function pilotForSchool(
  db: DbOrTx,
  school: ScopedSchoolDto,
  activity: { directorActive: boolean; secretaryActive: boolean } | undefined,
  activatedFamilies: Set<string>,
  from: string,
  to: string,
  today: string,
): Promise<{ school: PilotSchoolDto; businessDays: number }> {
  const measures = Object.fromEntries(PILOT_INDICATORS.map((k) => [k, none()])) as Record<
    PilotIndicator,
    PilotMeasure
  >;
  measures.centros_activos = {
    met: activity?.directorActive && activity.secretaryActive ? 1 : 0,
    total: 1,
  };
  const base = { schoolId: school.id, schoolName: school.name, districtName: school.districtName, measures };
  const year = await findCurrentYear(db, school.id);
  if (!year) return { school: base, businessDays: 0 };

  const start = from > year.startsOn ? from : year.startsOn;
  // Las licencias se cuentan hasta el final del período (registrarlas antes es lo bueno); la
  // asistencia y la planificación, solo hasta hoy: un día que todavía no llega no es un día sin lista.
  const end = to < year.endsOn ? to : year.endsOn;
  const lastDay = end < today ? end : today;
  const days = start <= lastDay ? businessDays(start, lastDay) : [];
  const [sectionList, assignments, periods] = await Promise.all([
    listSections(db, school.id, year.id),
    listAssignments(db, school.id, { schoolYearId: year.id }),
    listPeriods(db, school.id, year.id),
  ]);

  // ── Asistencia: días con lista por sección ──
  if (days.length && sectionList.length) {
    const recorded = await db
      .selectDistinct({ sectionId: attendanceRecords.sectionId, date: attendanceRecords.date })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.schoolId, school.id),
          gte(attendanceRecords.date, start),
          lte(attendanceRecords.date, lastDay),
        ),
      );
    const businessSet = new Set(days);
    measures.asistencia = {
      met: sectionList.filter((s) => {
        const own = recorded.filter((r) => r.sectionId === s.id && businessSet.has(r.date)).length;
        return own / days.length >= ATTENDANCE_DAYS_SHARE;
      }).length,
      total: sectionList.length,
    };
  }

  // ── Notas: el último parcial cerrado (o el vigente si todavía no cierra ninguno) ──
  const roster = await rosterOf(
    db,
    school.id,
    sectionList.map((s) => s.id),
  );
  const closed = [...periods]
    .filter((p) => p.closesOn <= lastDay)
    .sort((a, b) => b.closesOn.localeCompare(a.closesOn));
  const gradedPeriod = closed[0] ?? currentPeriod(periods, lastDay);
  const current = currentPeriod(periods, lastDay);
  const periodIds = [...new Set([gradedPeriod?.id, current?.id].filter((id): id is string => Boolean(id)))];
  const acts =
    periodIds.length && assignments.length
      ? await db
          .select({
            id: activities.id,
            assignmentId: activities.assignmentId,
            periodId: activities.periodId,
            maxPoints: activities.maxPoints,
          })
          .from(activities)
          .where(and(eq(activities.schoolId, school.id), inArray(activities.periodId, periodIds)))
      : [];
  if (gradedPeriod && assignments.length) {
    const own = acts.filter((a) => a.periodId === gradedPeriod.id);
    const marks = own.length
      ? await db
          .select({ activityId: scores.activityId, studentId: scores.studentId })
          .from(scores)
          .where(
            and(
              isNotNull(scores.points),
              inArray(
                scores.activityId,
                own.map((a) => a.id),
              ),
            ),
          )
      : [];
    const graded = new Set(marks.map((m) => `${m.activityId}:${m.studentId}`));
    measures.notas = {
      met: assignments.filter((a) => {
        const list = own.filter((x) => x.assignmentId === a.id);
        const kids = roster.filter((r) => r.sectionId === a.sectionId);
        const possible = list.reduce((acc, x) => acc + x.maxPoints, 0);
        return (
          possible >= 100 &&
          kids.length > 0 &&
          kids.every((k) => list.every((x) => graded.has(`${x.id}:${k.studentId}`)))
        );
      }).length,
      total: assignments.length,
    };
  }

  // ── Alerta temprana: clases del parcial vigente con puntos suficientes para proyectar ──
  if (current && assignments.length) {
    measures.alerta_temprana = {
      met: assignments.filter(
        (a) =>
          acts
            .filter((x) => x.periodId === current.id && x.assignmentId === a.id)
            .reduce((acc, x) => acc + x.maxPoints, 0) >= RISK_RULES.minPointsToProject,
      ).length,
      total: assignments.length,
    };
  }

  // ── Planificación: planes entregados de cada semana del período ──
  if (days.length && assignments.length) {
    const weeks = [...new Set(days.map(mondayOf))];
    let delivered = 0;
    let expected = 0;
    for (const week of weeks) {
      const board = await weekBoard(db, school.id, assignments, week, lastDay);
      expected += board.rows.length;
      delivered += board.rows.filter((r) => r.submittedAt !== null).length;
    }
    measures.planificacion = { met: delivered, total: expected };
  }

  // ── Licencias: registradas a tiempo y con alguna clase cubierta ──
  const leaves = await db
    .select({ id: teacherLeaves.id, startsOn: teacherLeaves.startsOn, createdAt: teacherLeaves.createdAt })
    .from(teacherLeaves)
    .where(
      and(
        eq(teacherLeaves.schoolId, school.id),
        isNull(teacherLeaves.cancelledAt),
        gte(teacherLeaves.startsOn, start),
        lte(teacherLeaves.startsOn, end),
      ),
    );
  if (leaves.length) {
    const covered = new Set(
      (
        await db
          .select({ leaveId: substitutions.leaveId })
          .from(substitutions)
          .where(
            and(
              isNull(substitutions.cancelledAt),
              inArray(
                substitutions.leaveId,
                leaves.map((l) => l.id),
              ),
            ),
          )
      ).map((s) => s.leaveId),
    );
    measures.licencias = {
      met: leaves.filter((l) => todayInHonduras(l.createdAt) <= l.startsOn && covered.has(l.id)).length,
      total: leaves.length,
    };
  }

  // ── Familias: alumnos con al menos un responsable que ya usa el portal ──
  const active = await db
    .select({ studentId: enrollments.studentId })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.schoolId, school.id),
        eq(enrollments.schoolYearId, year.id),
        eq(enrollments.status, "activa"),
      ),
    );
  if (active.length) {
    const links = await db
      .select({ studentId: studentGuardians.studentId, userId: guardians.userId })
      .from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(and(eq(studentGuardians.schoolId, school.id), isNotNull(guardians.userId)));
    const withFamily = new Set(
      links.filter((l) => l.userId && activatedFamilies.has(l.userId)).map((l) => l.studentId),
    );
    measures.familias = {
      met: active.filter((a) => withFamily.has(a.studentId)).length,
      total: active.length,
    };
  }

  return { school: base, businessDays: days.length };
}
