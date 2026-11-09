import type { AccessClaims } from "@escolar/service-kit";
import {
  type AssignmentDto,
  type AttendanceSheetDto,
  type AttendanceStatus,
  addDays,
  attendanceRate,
  currentPeriod,
  DEFAULT_PASSING_GRADE,
  defaultPeriods,
  type GradebookDto,
  type GradeProgressDto,
  type GradingPeriodDto,
  periodGrade,
  RISK_RULES,
  type SchoolFollowUpDto,
  type SectionDto,
  type StudentRiskDto,
  type TeacherClassDto,
} from "@escolar/shared";
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  attendanceRecords,
  enrollments,
  evaluationSettings,
  gradingPeriods,
  type SchoolYear,
  scores,
  students,
  substitutions,
  teacherLeaves,
  teachingAssignments,
} from "../db/schema";
import { findCurrentYear, listAssignments, listSections } from "./queries";

export const toPeriodDto = (p: typeof gradingPeriods.$inferSelect): GradingPeriodDto => ({
  id: p.id,
  number: p.number,
  name: p.name,
  startsOn: p.startsOn,
  endsOn: p.endsOn,
  closesOn: p.closesOn,
});

export async function passingGradeOf(db: DbOrTx, schoolId: string): Promise<number> {
  const [row] = await db.select().from(evaluationSettings).where(eq(evaluationSettings.schoolId, schoolId));
  return row?.passingGrade ?? DEFAULT_PASSING_GRADE;
}

export async function listPeriods(
  db: DbOrTx,
  schoolId: string,
  schoolYearId: string,
): Promise<GradingPeriodDto[]> {
  const rows = await db
    .select()
    .from(gradingPeriods)
    .where(and(eq(gradingPeriods.schoolId, schoolId), eq(gradingPeriods.schoolYearId, schoolYearId)))
    .orderBy(asc(gradingPeriods.number));
  return rows.map(toPeriodDto);
}

/** Crea los parciales por defecto del año si todavía no tiene. */
export async function ensureDefaultPeriods(db: DbOrTx, year: SchoolYear): Promise<GradingPeriodDto[]> {
  const existing = await listPeriods(db, year.schoolId, year.id);
  if (existing.length > 0) return existing;
  await db.insert(gradingPeriods).values(
    defaultPeriods(year.startsOn, year.endsOn).map((p, i) => ({
      schoolId: year.schoolId,
      schoolYearId: year.id,
      number: i + 1,
      ...p,
    })),
  );
  return listPeriods(db, year.schoolId, year.id);
}

/** Alumnos con matrícula activa en la sección, por apellido. */
export async function rosterOf(db: DbOrTx, schoolId: string, sectionIds: string[]) {
  if (sectionIds.length === 0) return [];
  return db
    .select({
      studentId: students.id,
      sectionId: enrollments.sectionId,
      firstNames: students.firstNames,
      lastNames: students.lastNames,
      nationalId: students.nationalId,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(
      and(
        eq(enrollments.schoolId, schoolId),
        inArray(enrollments.sectionId, sectionIds),
        eq(enrollments.status, "activa"),
      ),
    )
    .orderBy(asc(students.lastNames), asc(students.firstNames));
}

/** Clases que cubre hoy alguien como sustituto (licencia y sustitución vigentes). */
async function substitutionsCoveredBy(db: DbOrTx, schoolId: string, userId: string, date: string) {
  return db
    .select({ assignmentId: substitutions.assignmentId })
    .from(substitutions)
    .innerJoin(teacherLeaves, eq(teacherLeaves.id, substitutions.leaveId))
    .where(
      and(
        eq(substitutions.schoolId, schoolId),
        eq(substitutions.substituteUserId, userId),
        isNull(substitutions.cancelledAt),
        isNull(teacherLeaves.cancelledAt),
        lte(substitutions.startsOn, date),
        gte(substitutions.endsOn, date),
      ),
    );
}

/**
 * ¿Puede esta persona calificar esta clase hoy? La dirección y coordinación siempre; el titular,
 * mientras no esté de licencia; y el sustituto, solo mientras dura su sustitución.
 */
export async function canGrade(
  db: DbOrTx,
  auth: AccessClaims,
  assignment: Pick<AssignmentDto, "id" | "teacherUserId">,
  date: string,
): Promise<boolean> {
  if (auth.role === "admin" || auth.role === "coordinador") return true;
  if (!auth.schoolId) return false;
  if (assignment.teacherUserId === auth.userId) return true;
  const covered = await substitutionsCoveredBy(db, auth.schoolId, auth.userId, date);
  return covered.some((c) => c.assignmentId === assignment.id);
}

/** ¿Puede tomar asistencia en la sección? Dirección, coordinación, secretaría o quien da clases ahí. */
export async function canTakeAttendance(db: DbOrTx, auth: AccessClaims, section: SectionDto, date: string) {
  if (["admin", "coordinador", "secretaria"].includes(auth.role)) return true;
  if (!auth.schoolId) return false;
  const own = await db
    .select({ id: teachingAssignments.id })
    .from(teachingAssignments)
    .where(
      and(eq(teachingAssignments.sectionId, section.id), eq(teachingAssignments.teacherUserId, auth.userId)),
    )
    .limit(1);
  if (own.length) return true;
  const covered = await substitutionsCoveredBy(db, auth.schoolId, auth.userId, date);
  if (covered.length === 0) return false;
  const inSection = await db
    .select({ id: teachingAssignments.id })
    .from(teachingAssignments)
    .where(
      and(
        eq(teachingAssignments.sectionId, section.id),
        inArray(
          teachingAssignments.id,
          covered.map((c) => c.assignmentId),
        ),
      ),
    )
    .limit(1);
  return inSection.length > 0;
}

/** Clases del maestro: las propias del año vigente y las que cubre hoy como sustituto. */
export async function teacherClasses(
  db: DbOrTx,
  schoolId: string,
  userId: string,
  date: string,
): Promise<TeacherClassDto[]> {
  const year = await findCurrentYear(db, schoolId);
  if (!year) return [];
  const all = await listAssignments(db, schoolId, { schoolYearId: year.id });
  const covered = new Set(
    (await substitutionsCoveredBy(db, schoolId, userId, date)).map((c) => c.assignmentId),
  );
  const mine = all.filter((a) => a.teacherUserId === userId || covered.has(a.id));
  const roster = await rosterOf(db, schoolId, [...new Set(mine.map((a) => a.sectionId))]);
  return mine.map((assignment) => ({
    assignment,
    substituting: assignment.teacherUserId !== userId,
    students: roster.filter((r) => r.sectionId === assignment.sectionId).length,
  }));
}

export async function gradebook(
  db: DbOrTx,
  schoolId: string,
  assignment: AssignmentDto,
  periods: GradingPeriodDto[],
  period: GradingPeriodDto,
  canEdit: boolean,
): Promise<GradebookDto> {
  const passingGrade = await passingGradeOf(db, schoolId);
  const acts = await db
    .select()
    .from(activities)
    .where(and(eq(activities.assignmentId, assignment.id), eq(activities.periodId, period.id)))
    .orderBy(asc(activities.date), asc(activities.createdAt));
  const roster = await rosterOf(db, schoolId, [assignment.sectionId]);
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
  const activityDtos = acts.map((a) => ({ id: a.id, name: a.name, maxPoints: a.maxPoints, date: a.date }));

  return {
    assignment,
    period,
    periods,
    passingGrade,
    canEdit,
    activities: activityDtos,
    possible: activityDtos.reduce((acc, a) => acc + a.maxPoints, 0),
    students: roster.map((r) => {
      const own: Record<string, number | null> = {};
      for (const a of acts) {
        own[a.id] = marks.find((m) => m.activityId === a.id && m.studentId === r.studentId)?.points ?? null;
      }
      const result = periodGrade(activityDtos, own);
      return {
        studentId: r.studentId,
        name: `${r.lastNames}, ${r.firstNames}`,
        nationalId: r.nationalId,
        scores: own,
        ...result,
        atRisk:
          result.projected !== null &&
          result.possible >= RISK_RULES.minPointsToProject &&
          result.projected < passingGrade,
      };
    }),
  };
}

export async function attendanceSheet(
  db: DbOrTx,
  schoolId: string,
  section: SectionDto,
  date: string,
  canEdit: boolean,
): Promise<AttendanceSheetDto> {
  const roster = await rosterOf(db, schoolId, [section.id]);
  const marks = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.sectionId, section.id), eq(attendanceRecords.date, date)));
  const totals = { presente: 0, ausente: 0, tarde: 0, justificada: 0, sin_registro: 0 };
  const rows = roster.map((r) => {
    const status = (marks.find((m) => m.studentId === r.studentId)?.status ??
      null) as AttendanceStatus | null;
    totals[status ?? "sin_registro"]++;
    return { studentId: r.studentId, name: `${r.lastNames}, ${r.firstNames}`, status };
  });
  return { section, date, students: rows, totals, canEdit };
}

/**
 * Seguimiento del centro para la dirección (y, resumido, para la departamental):
 * avance de notas del parcial vigente, asistencia y alumnos en riesgo ANTES del cierre.
 */
export async function followUp(db: DbOrTx, schoolId: string, date: string): Promise<SchoolFollowUpDto> {
  const empty: SchoolFollowUpDto = {
    date,
    period: null,
    passingGrade: DEFAULT_PASSING_GRADE,
    daysToClose: null,
    gradeProgress: { complete: 0, total: 0, items: [] },
    attendance: { rate7d: null, sectionsRecordedToday: 0, sections: 0 },
    studentsAtRisk: [],
  };
  const year = await findCurrentYear(db, schoolId);
  if (!year) return empty;
  const [periods, passingGrade, assignments, sectionList] = await Promise.all([
    listPeriods(db, schoolId, year.id),
    passingGradeOf(db, schoolId),
    listAssignments(db, schoolId, { schoolYearId: year.id }),
    listSections(db, schoolId, year.id),
  ]);
  const period = currentPeriod(periods, date);
  const roster = await rosterOf(
    db,
    schoolId,
    sectionList.map((s) => s.id),
  );

  // ── Notas del parcial ──
  const acts = period
    ? await db
        .select()
        .from(activities)
        .where(and(eq(activities.schoolId, schoolId), eq(activities.periodId, period.id)))
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
  const scoreOf = (activityId: string, studentId: string) =>
    marks.find((m) => m.activityId === activityId && m.studentId === studentId)?.points ?? null;

  const items: GradeProgressDto[] = assignments.map((assignment) => {
    const own = acts.filter((a) => a.assignmentId === assignment.id);
    const kids = roster.filter((r) => r.sectionId === assignment.sectionId);
    const studentsComplete = kids.filter((k) => own.every((a) => scoreOf(a.id, k.studentId) !== null)).length;
    const possible = own.reduce((acc, a) => acc + a.maxPoints, 0);
    return {
      assignment,
      activities: own.length,
      possible,
      studentsComplete: own.length ? studentsComplete : 0,
      students: kids.length,
      complete: possible >= 100 && kids.length > 0 && studentsComplete === kids.length,
    };
  });

  // ── Asistencia ──
  const since = addDays(date, -(RISK_RULES.attendanceWindowDays - 1));
  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        gte(attendanceRecords.date, since),
        lte(attendanceRecords.date, date),
      ),
    );
  const last7 = addDays(date, -6);
  const rate7d = attendanceRate(records.filter((r) => r.date >= last7).map((r) => r.status));
  const sectionsRecordedToday = new Set(records.filter((r) => r.date === date).map((r) => r.sectionId)).size;

  // ── Alumnos en riesgo ──
  const studentsAtRisk: StudentRiskDto[] = [];
  for (const kid of roster) {
    const own = records.filter((r) => r.studentId === kid.studentId).map((r) => r.status);
    const rate = attendanceRate(own);
    const absences = own.filter((s) => s === "ausente").length;
    const counted = own.filter((s) => s !== "justificada").length;
    const attendanceRisk =
      absences >= RISK_RULES.maxAbsences ||
      (rate !== null && counted >= RISK_RULES.minAttendanceDays && rate < RISK_RULES.minAttendanceRate);

    const failing: StudentRiskDto["failing"] = [];
    for (const assignment of assignments.filter((a) => a.sectionId === kid.sectionId)) {
      const own2 = acts.filter((a) => a.assignmentId === assignment.id);
      const result = periodGrade(
        own2,
        Object.fromEntries(own2.map((a) => [a.id, scoreOf(a.id, kid.studentId)])),
      );
      if (
        result.projected !== null &&
        result.possible >= RISK_RULES.minPointsToProject &&
        result.projected < passingGrade
      ) {
        failing.push({ subjectName: assignment.subjectName, projected: result.projected });
      }
    }
    if (attendanceRisk || failing.length) {
      studentsAtRisk.push({
        studentId: kid.studentId,
        name: `${kid.lastNames}, ${kid.firstNames}`,
        sectionId: kid.sectionId,
        sectionLabel: sectionList.find((s) => s.id === kid.sectionId)?.label ?? "",
        attendanceRate: rate,
        absences,
        failing,
      });
    }
  }

  return {
    date,
    period,
    passingGrade,
    daysToClose: period
      ? Math.round(
          (Date.parse(`${period.closesOn}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000,
        )
      : null,
    gradeProgress: { complete: items.filter((i) => i.complete).length, total: items.length, items },
    attendance: { rate7d, sectionsRecordedToday, sections: sectionList.length },
    studentsAtRisk,
  };
}
