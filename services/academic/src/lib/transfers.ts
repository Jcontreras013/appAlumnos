import { attendanceRate, periodGrade, type TransferSnapshot } from "@escolar/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  attendanceRecords,
  enrollments,
  guardians,
  scores,
  studentGuardians,
  students,
} from "../db/schema";
import { listPeriods } from "./evaluation";
import { findCurrentYear, getSection, listAssignments } from "./queries";

/**
 * Lo que viaja con un alumno trasladado: sus datos, sus responsables y cómo iba en el año (nota de
 * cada parcial por materia y asistencia). Es una copia: el centro de origen conserva su registro.
 */
export async function transferSnapshot(
  db: DbOrTx,
  schoolId: string,
  studentId: string,
): Promise<TransferSnapshot> {
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)));
  if (!student) throw new Error("Alumno no encontrado");
  const links = await db
    .select({
      guardian: guardians,
      relationship: studentGuardians.relationship,
      isPrimary: studentGuardians.isPrimary,
    })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, studentId)));

  const history: TransferSnapshot["history"] = {
    schoolYearName: null,
    sectionLabel: null,
    periods: [],
    subjects: [],
    attendance: { days: 0, absent: 0, rate: null },
  };
  const year = await findCurrentYear(db, schoolId);
  const [enrollment] = year
    ? await db
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.schoolId, schoolId),
            eq(enrollments.studentId, studentId),
            eq(enrollments.schoolYearId, year.id),
          ),
        )
    : [];
  if (year && enrollment) {
    const section = await getSection(db, schoolId, enrollment.sectionId);
    const periods = await listPeriods(db, schoolId, year.id);
    const classes = (await listAssignments(db, schoolId, { schoolYearId: year.id })).filter(
      (a) => a.sectionId === section.id,
    );
    const acts = classes.length
      ? await db
          .select()
          .from(activities)
          .where(
            and(
              eq(activities.schoolId, schoolId),
              inArray(
                activities.assignmentId,
                classes.map((c) => c.id),
              ),
            ),
          )
      : [];
    const marks = acts.length
      ? await db
          .select()
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
    const days = await db
      .select({ status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.studentId, studentId),
          eq(attendanceRecords.sectionId, section.id),
        ),
      );
    history.schoolYearName = year.name;
    history.sectionLabel = section.label;
    history.periods = periods.map((p) => p.name);
    history.subjects = classes.map((c) => ({
      name: c.subjectName,
      grades: periods.map((p) => {
        const list = acts.filter((a) => a.assignmentId === c.id && a.periodId === p.id);
        return periodGrade(list, Object.fromEntries(list.map((a) => [a.id, pointsOf.get(a.id)]))).grade;
      }),
    }));
    history.attendance = {
      days: days.length,
      absent: days.filter((d) => d.status === "ausente").length,
      rate: attendanceRate(days.map((d) => d.status)),
    };
  }

  return {
    student: {
      firstNames: student.firstNames,
      lastNames: student.lastNames,
      nationalId: student.nationalId,
      birthDate: student.birthDate,
      sex: student.sex,
      medicalNotes: student.medicalNotes,
    },
    guardians: links.map((l) => ({
      fullName: l.guardian.fullName,
      nationalId: l.guardian.nationalId,
      phone: l.guardian.phone,
      email: l.guardian.email,
      relationship: l.relationship,
      isPrimary: l.isPrimary,
    })),
    history,
  };
}
