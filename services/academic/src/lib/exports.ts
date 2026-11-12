import {
  type AttendanceStatus,
  attendanceRate,
  type ExportAttendanceDayRow,
  type ExportAttendanceRow,
  type ExportGradeRow,
  type ExportStudentRow,
  periodGrade,
  type SchoolExportDto,
} from "@escolar/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  attendanceRecords,
  enrollments,
  grades,
  guardians,
  scores,
  sections,
  studentGuardians,
  students,
} from "../db/schema";
import { listPeriods, rosterOf } from "./evaluation";
import { findCurrentYear, listAssignments, listSections } from "./queries";

/** Ningún año tiene este id: sirve para "sin año vigente" sin cambiar la forma de la consulta. */
const NO_YEAR = "00000000-0000-0000-0000-000000000000";

/**
 * Alumnos del centro con su matrícula del año vigente (si tienen) y su responsable principal.
 * Ordenados por grado, sección y apellidos; los que no están matriculados este año van al final.
 */
export async function studentRows(
  db: DbOrTx,
  schoolId: string,
  schoolYearId: string | null,
): Promise<ExportStudentRow[]> {
  const rows = await db
    .select({
      student: students,
      enrollment: enrollments,
      sectionName: sections.name,
      gradeName: grades.name,
      guardian: guardians,
      relationship: studentGuardians.relationship,
    })
    .from(students)
    .leftJoin(
      enrollments,
      and(eq(enrollments.studentId, students.id), eq(enrollments.schoolYearId, schoolYearId ?? NO_YEAR)),
    )
    .leftJoin(sections, eq(sections.id, enrollments.sectionId))
    .leftJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(
      studentGuardians,
      and(eq(studentGuardians.studentId, students.id), eq(studentGuardians.isPrimary, true)),
    )
    .leftJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(eq(students.schoolId, schoolId))
    .orderBy(
      asc(grades.sortOrder),
      asc(grades.name),
      asc(sections.name),
      asc(students.lastNames),
      asc(students.firstNames),
    );
  return rows.map(({ student, enrollment, sectionName, gradeName, guardian, relationship }) => ({
    nationalId: student.nationalId,
    lastNames: student.lastNames,
    firstNames: student.firstNames,
    birthDate: student.birthDate,
    sex: student.sex,
    gradeName,
    sectionName,
    status: enrollment?.status ?? null,
    enrolledOn: enrollment?.enrolledOn ?? null,
    withdrawnOn: enrollment?.withdrawnOn ?? null,
    guardianName: guardian?.fullName ?? null,
    guardianRelationship: relationship,
    guardianPhone: guardian?.phone ?? null,
    guardianEmail: guardian?.email ?? null,
    guardianNationalId: guardian?.nationalId ?? null,
  }));
}

/** Todo lo del año vigente de un centro: matrícula, notas por parcial y asistencia. */
export async function schoolExport(db: DbOrTx, schoolId: string, today: string): Promise<SchoolExportDto> {
  const year = await findCurrentYear(db, schoolId);
  const students_ = await studentRows(db, schoolId, year?.id ?? null);
  if (!year) {
    return {
      schoolYear: null,
      generatedOn: today,
      periods: [],
      students: students_,
      grades: [],
      attendance: [],
      attendanceDays: [],
    };
  }

  const [sectionList, assignmentList, periods] = await Promise.all([
    listSections(db, schoolId, year.id),
    listAssignments(db, schoolId, { schoolYearId: year.id }),
    listPeriods(db, schoolId, year.id),
  ]);
  const sectionIds = sectionList.map((s) => s.id);
  const sectionOf = new Map(sectionList.map((s) => [s.id, s]));
  const roster = await rosterOf(db, schoolId, sectionIds);

  // ── Notas: una fila por alumno y materia, con la nota de cada parcial ──
  const assignmentIds = assignmentList.map((a) => a.id);
  const acts = assignmentIds.length
    ? await db
        .select({
          id: activities.id,
          assignmentId: activities.assignmentId,
          periodId: activities.periodId,
          maxPoints: activities.maxPoints,
        })
        .from(activities)
        .where(and(eq(activities.schoolId, schoolId), inArray(activities.assignmentId, assignmentIds)))
    : [];
  const marks = acts.length
    ? await db
        .select({ activityId: scores.activityId, studentId: scores.studentId, points: scores.points })
        .from(scores)
        .where(
          and(
            eq(scores.schoolId, schoolId),
            inArray(
              scores.activityId,
              acts.map((a) => a.id),
            ),
          ),
        )
    : [];
  const actsOf = new Map<string, typeof acts>();
  for (const act of acts) {
    const key = `${act.assignmentId}:${act.periodId}`;
    actsOf.set(key, [...(actsOf.get(key) ?? []), act]);
  }
  const pointsOf = new Map(marks.map((m) => [`${m.activityId}:${m.studentId}`, m.points]));

  const gradeRows: ExportGradeRow[] = [];
  for (const section of sectionList) {
    const own = assignmentList
      .filter((a) => a.sectionId === section.id)
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "es"));
    for (const kid of roster.filter((r) => r.sectionId === section.id)) {
      for (const assignment of own) {
        const byPeriod = periods.map((period) => {
          const list = actsOf.get(`${assignment.id}:${period.id}`) ?? [];
          const scoresFor = Object.fromEntries(
            list.map((a) => [a.id, pointsOf.get(`${a.id}:${kid.studentId}`)]),
          );
          return periodGrade(list, scoresFor).grade;
        });
        const done = byPeriod.filter((g): g is number => g !== null);
        gradeRows.push({
          gradeName: section.gradeName,
          sectionName: section.name,
          nationalId: kid.nationalId,
          studentName: `${kid.lastNames}, ${kid.firstNames}`,
          subjectName: assignment.subjectName,
          teacherName: assignment.teacherName,
          periods: byPeriod,
          average: done.length ? Math.round((done.reduce((a, b) => a + b, 0) / done.length) * 10) / 10 : null,
        });
      }
    }
  }

  // ── Asistencia: resumen por alumno y el detalle de cada día ──
  const records = sectionIds.length
    ? await db
        .select({
          date: attendanceRecords.date,
          sectionId: attendanceRecords.sectionId,
          studentId: attendanceRecords.studentId,
          status: attendanceRecords.status,
        })
        .from(attendanceRecords)
        .where(
          and(eq(attendanceRecords.schoolId, schoolId), inArray(attendanceRecords.sectionId, sectionIds)),
        )
        .orderBy(asc(attendanceRecords.date))
    : [];
  const people = new Map(
    (
      await db
        .select({
          id: students.id,
          lastNames: students.lastNames,
          firstNames: students.firstNames,
          nationalId: students.nationalId,
        })
        .from(students)
        .where(eq(students.schoolId, schoolId))
    ).map((p) => [p.id, p]),
  );
  const nameOf = (id: string) => {
    const p = people.get(id);
    return p ? `${p.lastNames}, ${p.firstNames}` : "";
  };

  const bySectionStudent = new Map<string, AttendanceStatus[]>();
  for (const r of records) {
    const key = `${r.sectionId}:${r.studentId}`;
    bySectionStudent.set(key, [...(bySectionStudent.get(key) ?? []), r.status]);
  }
  const sectionOrder = new Map(sectionIds.map((id, i) => [id, i]));
  const attendance: ExportAttendanceRow[] = [...bySectionStudent.entries()]
    .map(([key, statuses]) => {
      const [sectionId = "", studentId = ""] = key.split(":");
      const section = sectionOf.get(sectionId);
      const count = (s: AttendanceStatus) => statuses.filter((x) => x === s).length;
      return {
        sectionId,
        row: {
          gradeName: section?.gradeName ?? "",
          sectionName: section?.name ?? "",
          nationalId: people.get(studentId)?.nationalId ?? null,
          studentName: nameOf(studentId),
          days: statuses.length,
          present: count("presente"),
          absent: count("ausente"),
          late: count("tarde"),
          justified: count("justificada"),
          rate: attendanceRate(statuses),
        },
      };
    })
    .sort(
      (a, b) =>
        (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0) ||
        a.row.studentName.localeCompare(b.row.studentName, "es"),
    )
    .map((x) => x.row);

  const attendanceDays: ExportAttendanceDayRow[] = records
    .map((r) => {
      const section = sectionOf.get(r.sectionId);
      return {
        date: r.date,
        gradeName: section?.gradeName ?? "",
        sectionName: section?.name ?? "",
        nationalId: people.get(r.studentId)?.nationalId ?? null,
        studentName: nameOf(r.studentId),
        status: r.status,
        order: sectionOrder.get(r.sectionId) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.order - b.order || a.studentName.localeCompare(b.studentName, "es"),
    )
    .map(({ order: _order, ...row }) => row);

  return {
    schoolYear: year.name,
    generatedOn: today,
    periods: periods.map((p) => p.name),
    students: students_,
    grades: gradeRows,
    attendance,
    attendanceDays,
  };
}
