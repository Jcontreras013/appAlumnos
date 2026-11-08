import { conflict, notFound } from "@escolar/service-kit";
import type { AssignmentDto, GradeDto, SchoolYearDto, SectionDto, SubjectDto } from "@escolar/shared";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  enrollments,
  type Grade,
  grades,
  type SchoolYear,
  type Subject,
  schoolYears,
  sections,
  subjects,
  teachingAssignments,
} from "../db/schema";

export const sectionLabel = (gradeName: string, sectionName: string) => `${gradeName} ${sectionName}`;

export const toSchoolYearDto = (y: SchoolYear): SchoolYearDto => ({
  id: y.id,
  name: y.name,
  startsOn: y.startsOn,
  endsOn: y.endsOn,
  isCurrent: y.isCurrent,
});
export const toGradeDto = (g: Grade): GradeDto => ({ id: g.id, name: g.name, sortOrder: g.sortOrder });
export const toSubjectDto = (s: Subject): SubjectDto => ({ id: s.id, name: s.name });

export async function findCurrentYear(db: DbOrTx, schoolId: string): Promise<SchoolYear | null> {
  const [year] = await db
    .select()
    .from(schoolYears)
    .where(and(eq(schoolYears.schoolId, schoolId), eq(schoolYears.isCurrent, true)));
  return year ?? null;
}

export async function requireCurrentYear(db: DbOrTx, schoolId: string): Promise<SchoolYear> {
  const year = await findCurrentYear(db, schoolId);
  if (!year) throw conflict("Primero configura el año lectivo vigente en Estructura académica");
  return year;
}

/** Alumnos con matrícula activa por sección. */
const activeCounts = (db: DbOrTx) =>
  db
    .select({ sectionId: enrollments.sectionId, enrolled: count().as("enrolled") })
    .from(enrollments)
    .where(eq(enrollments.status, "activa"))
    .groupBy(enrollments.sectionId)
    .as("active_counts");

export async function listSections(
  db: DbOrTx,
  schoolId: string,
  schoolYearId: string,
): Promise<SectionDto[]> {
  const counts = activeCounts(db);
  const rows = await db
    .select({ section: sections, gradeName: grades.name, enrolled: counts.enrolled })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(counts, eq(counts.sectionId, sections.id))
    .where(and(eq(sections.schoolId, schoolId), eq(sections.schoolYearId, schoolYearId)))
    .orderBy(asc(grades.sortOrder), asc(grades.name), asc(sections.name));
  return rows.map(({ section, gradeName, enrolled }) => ({
    id: section.id,
    schoolYearId: section.schoolYearId,
    gradeId: section.gradeId,
    gradeName,
    name: section.name,
    label: sectionLabel(gradeName, section.name),
    capacity: section.capacity,
    enrolledCount: Number(enrolled ?? 0),
  }));
}

export async function getSection(db: DbOrTx, schoolId: string, sectionId: string): Promise<SectionDto> {
  const counts = activeCounts(db);
  const [row] = await db
    .select({ section: sections, gradeName: grades.name, enrolled: counts.enrolled })
    .from(sections)
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .leftJoin(counts, eq(counts.sectionId, sections.id))
    .where(and(eq(sections.schoolId, schoolId), eq(sections.id, sectionId)));
  if (!row) throw notFound("Sección no encontrada");
  return {
    id: row.section.id,
    schoolYearId: row.section.schoolYearId,
    gradeId: row.section.gradeId,
    gradeName: row.gradeName,
    name: row.section.name,
    label: sectionLabel(row.gradeName, row.section.name),
    capacity: row.section.capacity,
    enrolledCount: Number(row.enrolled ?? 0),
  };
}

export async function listAssignments(
  db: DbOrTx,
  schoolId: string,
  filter: { schoolYearId: string; teacherUserId?: string },
): Promise<AssignmentDto[]> {
  const rows = await db
    .select({
      assignment: teachingAssignments,
      schoolYearId: sections.schoolYearId,
      sectionName: sections.name,
      gradeName: grades.name,
      subjectName: subjects.name,
    })
    .from(teachingAssignments)
    .innerJoin(sections, eq(sections.id, teachingAssignments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .innerJoin(subjects, eq(subjects.id, teachingAssignments.subjectId))
    .where(
      and(
        eq(teachingAssignments.schoolId, schoolId),
        eq(sections.schoolYearId, filter.schoolYearId),
        filter.teacherUserId ? eq(teachingAssignments.teacherUserId, filter.teacherUserId) : undefined,
      ),
    )
    .orderBy(asc(grades.sortOrder), asc(grades.name), asc(sections.name), asc(subjects.name));
  return rows.map((r) => ({
    id: r.assignment.id,
    schoolYearId: r.schoolYearId,
    sectionId: r.assignment.sectionId,
    sectionLabel: sectionLabel(r.gradeName, r.sectionName),
    subjectId: r.assignment.subjectId,
    subjectName: r.subjectName,
    teacherUserId: r.assignment.teacherUserId,
    teacherName: r.assignment.teacherName,
  }));
}

/** Bloquea la fila de la sección hasta que termine la transacción (control de cupo sin carreras). */
export async function lockSection(tx: DbOrTx, schoolId: string, sectionId: string) {
  const [section] = await tx
    .select()
    .from(sections)
    .where(and(eq(sections.schoolId, schoolId), eq(sections.id, sectionId)))
    .for("update");
  if (!section) throw notFound("Sección no encontrada");
  return section;
}

export async function countActive(tx: DbOrTx, sectionId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(and(eq(enrollments.sectionId, sectionId), eq(enrollments.status, "activa")));
  return row?.n ?? 0;
}
