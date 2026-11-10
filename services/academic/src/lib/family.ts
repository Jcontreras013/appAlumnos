import { notFound } from "@escolar/service-kit";
import {
  type AttendanceStatus,
  addDays,
  attendanceRate,
  currentPeriod,
  type FamilyChildDto,
  type FamilyChildSummaryDto,
  type FamilyHomeworkDto,
  type FamilySubjectDto,
  mondayOf,
  type PlanField,
  periodGrade,
  RISK_RULES,
  roundGrade,
} from "@escolar/shared";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  attendanceRecords,
  enrollments,
  guardians,
  lessonPlans,
  scores,
  studentGuardians,
  students,
} from "../db/schema";
import { ensureDefaultPeriods, passingGradeOf } from "./evaluation";
import { findCurrentYear, getSection, listAssignments } from "./queries";

const oneDecimal = (n: number) => Math.round(n * 10) / 10;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Alumnos que una cuenta de familia puede ver en este centro (los de sus fichas de encargado). */
export async function childrenOf(db: DbOrTx, schoolId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ studentId: studentGuardians.studentId })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .innerJoin(students, eq(students.id, studentGuardians.studentId))
    .where(and(eq(guardians.schoolId, schoolId), eq(guardians.userId, userId)))
    .orderBy(asc(students.firstNames));
  return [...new Set(rows.map((r) => r.studentId))];
}

/** Texto de un campo de la planificación (por clave, o el primero cuyo nombre lo mencione). */
function planText(fields: PlanField[], content: Record<string, unknown>, key: string, label: RegExp) {
  const field =
    fields.find((f) => f.key === key) ?? fields.find((f) => f.type !== "dias" && label.test(f.label));
  const value = field ? content[field.key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Lo que la familia ve de un hijo (y lo que se imprime en la boleta): notas por parcial y materia,
 * actividades del parcial vigente, asistencia y las tareas de la planificación de esta semana y la próxima.
 */
export async function familyChild(
  db: DbOrTx,
  schoolId: string,
  studentId: string,
  today: string,
): Promise<FamilyChildDto> {
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)));
  if (!student) throw notFound("Alumno no encontrado");

  const year = await findCurrentYear(db, schoolId);
  const [enrollment] = year
    ? await db
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.studentId, studentId),
            eq(enrollments.schoolYearId, year.id),
            eq(enrollments.status, "activa"),
          ),
        )
    : [];
  const section = enrollment ? await getSection(db, schoolId, enrollment.sectionId) : null;
  const periods = year ? await ensureDefaultPeriods(db, year) : [];
  const period = currentPeriod(periods, today);
  const passingGrade = await passingGradeOf(db, schoolId);
  const assignments =
    year && section
      ? (await listAssignments(db, schoolId, { schoolYearId: year.id })).filter(
          (a) => a.sectionId === section.id,
        )
      : [];

  // ── Notas ──
  const acts = assignments.length
    ? await db
        .select()
        .from(activities)
        .where(
          inArray(
            activities.assignmentId,
            assignments.map((a) => a.id),
          ),
        )
        .orderBy(asc(activities.date))
    : [];
  const marks = acts.length
    ? await db
        .select({ activityId: scores.activityId, points: scores.points })
        .from(scores)
        .where(
          and(
            eq(scores.studentId, studentId),
            inArray(
              scores.activityId,
              acts.map((a) => a.id),
            ),
          ),
        )
    : [];
  const pointsOf = new Map(marks.map((m) => [m.activityId, m.points]));

  const subjects: FamilySubjectDto[] = assignments.map((a) => {
    const own = acts.filter((x) => x.assignmentId === a.id);
    const grades: FamilySubjectDto["grades"] = {};
    for (const p of periods) {
      const inPeriod = own.filter((x) => x.periodId === p.id);
      if (!inPeriod.length) continue;
      const result = periodGrade(
        inPeriod,
        Object.fromEntries(inPeriod.map((x) => [x.id, pointsOf.get(x.id) ?? null])),
      );
      grades[p.id] = {
        grade: result.grade,
        projected: result.projected,
        points: result.points,
        possible: result.possible,
      };
    }
    const closed = periods
      .map((p) => grades[p.id]?.grade)
      .filter((g): g is number => g !== null && g !== undefined);
    const current = period ? grades[period.id] : undefined;
    const average = mean(closed);
    return {
      assignmentId: a.id,
      subjectName: a.subjectName,
      teacherName: a.teacherName,
      grades,
      activities: own
        .filter((x) => x.periodId === period?.id)
        .map((x) => ({
          name: x.name,
          date: x.date,
          maxPoints: x.maxPoints,
          points: pointsOf.get(x.id) ?? null,
        })),
      average: average === null ? null : oneDecimal(average),
      atRisk:
        current?.projected !== null &&
        current?.projected !== undefined &&
        current.possible >= RISK_RULES.minPointsToProject &&
        current.projected < passingGrade,
    };
  });

  // ── Asistencia ──
  const records = section
    ? await db
        .select({ date: attendanceRecords.date, status: attendanceRecords.status })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.studentId, studentId),
            eq(attendanceRecords.sectionId, section.id),
            gte(attendanceRecords.date, year?.startsOn ?? today),
          ),
        )
    : [];
  const since30 = addDays(today, -RISK_RULES.attendanceWindowDays);
  const last30 = records.filter((r) => r.date >= since30 && r.date <= today);
  const count = (status: AttendanceStatus) => last30.filter((r) => r.status === status).length;
  const rate30d = attendanceRate(last30.map((r) => r.status as AttendanceStatus));
  const absences30d = count("ausente");
  const attendanceRisk =
    absences30d >= RISK_RULES.maxAbsences ||
    (rate30d !== null &&
      last30.length >= RISK_RULES.minAttendanceDays &&
      rate30d < RISK_RULES.minAttendanceRate);

  // ── Tareas de la planificación (esta semana y la próxima) ──
  const week = mondayOf(today);
  const plans = assignments.length
    ? await db
        .select()
        .from(lessonPlans)
        .where(
          and(
            inArray(
              lessonPlans.assignmentId,
              assignments.map((a) => a.id),
            ),
            inArray(lessonPlans.weekStart, [week, addDays(week, 7)]),
            inArray(lessonPlans.status, ["enviada", "aprobada"]),
          ),
        )
    : [];
  const homework: FamilyHomeworkDto[] = plans
    .map((p) => ({
      subjectName: assignments.find((a) => a.id === p.assignmentId)?.subjectName ?? "",
      weekStart: p.weekStart,
      topic: planText(p.fields, p.content, "tema", /tema/i),
      homework: planText(p.fields, p.content, "tareas", /tarea/i),
    }))
    .filter((h) => h.topic || h.homework)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.subjectName.localeCompare(b.subjectName));

  const averages = subjects.map((s) => s.average).filter((a): a is number => a !== null);
  const general = mean(averages);

  return {
    student: {
      id: student.id,
      name: `${student.firstNames} ${student.lastNames}`,
      nationalId: student.nationalId,
      sectionLabel: section?.label ?? null,
      schoolYearName: year?.name ?? null,
    },
    passingGrade,
    periods,
    period,
    subjects,
    attendance: {
      rate30d,
      absences30d,
      tardies30d: count("tarde"),
      justified30d: count("justificada"),
      recordedDays30d: last30.length,
      yearRate: attendanceRate(records.map((r) => r.status as AttendanceStatus)),
      recent: records
        .filter((r) => r.status !== "presente" && r.date >= addDays(today, -60))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((r) => ({ date: r.date, status: r.status as AttendanceStatus })),
    },
    homework,
    generalAverage: general === null ? null : oneDecimal(general),
    atRisk: subjects.some((s) => s.atRisk) || attendanceRisk,
  };
}

export function summarize(child: FamilyChildDto, today: string): FamilyChildSummaryDto {
  const current = child.period
    ? child.subjects
        .map((s) => s.grades[child.period?.id ?? ""]?.projected)
        .filter((p): p is number => p !== null && p !== undefined)
    : [];
  const average = mean(current);
  return {
    studentId: child.student.id,
    name: child.student.name,
    sectionLabel: child.student.sectionLabel,
    periodName: child.period?.name ?? null,
    periodAverage: average === null ? null : roundGrade(average),
    attendanceRate30d: child.attendance.rate30d,
    absences30d: child.attendance.absences30d,
    subjectsAtRisk: child.subjects.filter((s) => s.atRisk).map((s) => s.subjectName),
    homeworkThisWeek: child.homework.filter((h) => h.weekStart === mondayOf(today) && h.homework).length,
  };
}
