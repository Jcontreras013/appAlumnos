import { conflict, isUniqueViolation, notFound } from "@escolar/service-kit";
import type {
  EnrollmentDto,
  GuardianInput,
  GuardianLinkDto,
  StudentDetailDto,
  StudentFields,
} from "@escolar/shared";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  enrollments,
  type Guardian,
  grades,
  guardians,
  type Student,
  schoolYears,
  sections,
  studentGuardians,
  students,
} from "../db/schema";
import { sectionLabel } from "./queries";

export const studentValues = (input: StudentFields) => ({
  firstNames: input.firstNames,
  lastNames: input.lastNames,
  nationalId: input.nationalId ?? null,
  birthDate: input.birthDate ?? null,
  sex: input.sex ?? null,
  medicalNotes: input.medicalNotes ?? null,
  notes: input.notes ?? null,
});

export async function insertStudent(db: DbOrTx, schoolId: string, input: StudentFields): Promise<Student> {
  try {
    const [student] = await db
      .insert(students)
      .values({ schoolId, ...studentValues(input) })
      .returning();
    if (!student) throw new Error("No se creó el alumno");
    return student;
  } catch (err) {
    if (isUniqueViolation(err, "students_national_id_unique")) {
      throw conflict("Ya existe un alumno con ese número de identidad");
    }
    throw err;
  }
}

/**
 * Busca al responsable por número de identidad dentro del colegio; si no existe, lo crea.
 * Así dos hermanos matriculados por separado quedan ligados al mismo responsable (la misma familia).
 * Si el responsable ya existía, solo se completan los datos de contacto que le faltaban.
 */
export async function findOrCreateGuardian(
  db: DbOrTx,
  schoolId: string,
  input: Omit<GuardianInput, "relationship" | "isPrimary">,
): Promise<{ guardian: Guardian; reused: boolean }> {
  if (input.nationalId) {
    const [existing] = await db
      .select()
      .from(guardians)
      .where(and(eq(guardians.schoolId, schoolId), eq(guardians.nationalId, input.nationalId)));
    if (existing) {
      const patch = {
        ...(existing.phone ? {} : input.phone ? { phone: input.phone } : {}),
        ...(existing.email ? {} : input.email ? { email: input.email } : {}),
      };
      if (Object.keys(patch).length === 0) return { guardian: existing, reused: true };
      const [updated] = await db
        .update(guardians)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(guardians.id, existing.id))
        .returning();
      return { guardian: updated ?? existing, reused: true };
    }
  }
  const [guardian] = await db
    .insert(guardians)
    .values({
      schoolId,
      fullName: input.fullName,
      nationalId: input.nationalId ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    })
    .returning();
  if (!guardian) throw new Error("No se creó el responsable");
  return { guardian, reused: false };
}

export async function getStudentDetail(
  db: DbOrTx,
  schoolId: string,
  studentId: string,
): Promise<StudentDetailDto> {
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)));
  if (!student) throw notFound("Alumno no encontrado");

  const links = await db
    .select({ link: studentGuardians, guardian: guardians })
    .from(studentGuardians)
    .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
    .where(eq(studentGuardians.studentId, student.id))
    .orderBy(desc(studentGuardians.isPrimary), asc(guardians.fullName));

  const enrollmentRows = await db
    .select({
      enrollment: enrollments,
      yearName: schoolYears.name,
      yearStart: schoolYears.startsOn,
      sectionName: sections.name,
      gradeName: grades.name,
    })
    .from(enrollments)
    .innerJoin(schoolYears, eq(schoolYears.id, enrollments.schoolYearId))
    .innerJoin(sections, eq(sections.id, enrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(eq(enrollments.studentId, student.id))
    .orderBy(desc(schoolYears.startsOn));

  const guardianIds = links.map((l) => l.guardian.id);
  const siblings = guardianIds.length
    ? await db
        .selectDistinct({ id: students.id, firstNames: students.firstNames, lastNames: students.lastNames })
        .from(studentGuardians)
        .innerJoin(students, eq(students.id, studentGuardians.studentId))
        .where(and(inArray(studentGuardians.guardianId, guardianIds), ne(students.id, student.id)))
    : [];

  return {
    id: student.id,
    firstNames: student.firstNames,
    lastNames: student.lastNames,
    nationalId: student.nationalId,
    birthDate: student.birthDate,
    sex: student.sex,
    medicalNotes: student.medicalNotes,
    notes: student.notes,
    guardians: links.map(
      ({ link, guardian }): GuardianLinkDto => ({
        id: guardian.id,
        fullName: guardian.fullName,
        nationalId: guardian.nationalId,
        phone: guardian.phone,
        email: guardian.email,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        hasPortalAccess: guardian.userId !== null,
      }),
    ),
    enrollments: enrollmentRows.map(
      (r): EnrollmentDto => ({
        id: r.enrollment.id,
        schoolYearId: r.enrollment.schoolYearId,
        schoolYearName: r.yearName,
        sectionId: r.enrollment.sectionId,
        sectionLabel: sectionLabel(r.gradeName, r.sectionName),
        status: r.enrollment.status,
        enrolledOn: r.enrollment.enrolledOn,
        withdrawnOn: r.enrollment.withdrawnOn,
        withdrawReason: r.enrollment.withdrawReason,
      }),
    ),
    siblings: siblings.map((s) => ({ id: s.id, fullName: `${s.firstNames} ${s.lastNames}` })),
    createdAt: student.createdAt.toISOString(),
  };
}
