import { type AccessClaims, forbidden } from "@escolar/service-kit";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { enrollments, evaluationSettings } from "../db/schema";
import { findCurrentYear, listAssignments } from "./queries";

/**
 * Matrícula por los maestros: si la dirección la activa, cada maestro registra y matricula a los
 * alumnos de las secciones donde da clase (año vigente). Retiros, traslados, importación y accesos
 * siguen siendo de la secretaría y la dirección.
 */
export async function teachersEnrollOf(db: DbOrTx, schoolId: string): Promise<boolean> {
  const [row] = await db
    .select({ teachersEnroll: evaluationSettings.teachersEnroll })
    .from(evaluationSettings)
    .where(eq(evaluationSettings.schoolId, schoolId));
  return row?.teachersEnroll ?? false;
}

/** Secciones del año vigente donde la persona da alguna clase. */
export async function teacherSectionIds(db: DbOrTx, schoolId: string, userId: string): Promise<string[]> {
  const year = await findCurrentYear(db, schoolId);
  if (!year) return [];
  const own = await listAssignments(db, schoolId, { schoolYearId: year.id, teacherUserId: userId });
  return [...new Set(own.map((a) => a.sectionId))];
}

export type EnrollScope = { kind: "office" } | { kind: "teacher"; sectionIds: string[] };

/**
 * Qué alumnos puede tocar quien pide: la secretaría y la dirección, todos; un maestro, solo si la
 * dirección activó la matrícula por maestros, y solo en sus secciones.
 */
export async function enrollScope(db: DbOrTx, auth: AccessClaims, schoolId: string): Promise<EnrollScope> {
  if (auth.role !== "docente") return { kind: "office" };
  if (!(await teachersEnrollOf(db, schoolId))) {
    throw forbidden("La dirección no ha activado la matrícula por maestros");
  }
  return { kind: "teacher", sectionIds: await teacherSectionIds(db, schoolId, auth.userId) };
}

/** La sección es una de las del maestro (para matricular o registrar ahí). */
export function assertTeacherSection(scope: EnrollScope, sectionId: string | undefined | null) {
  if (scope.kind === "office") return;
  if (!sectionId) throw forbidden("Elige una de tus secciones para matricular al alumno");
  if (!scope.sectionIds.includes(sectionId)) {
    throw forbidden("Solo puedes matricular en las secciones donde das clase");
  }
}

/**
 * Un maestro ve la ficha de un alumno de sus secciones, o de uno que todavía no tiene matrícula este
 * año (para volver a matricularlo). Con `edit`, solo los de sus secciones.
 */
export async function assertTeacherStudent(
  db: DbOrTx,
  scope: EnrollScope,
  schoolId: string,
  studentId: string,
  { edit = false } = {},
) {
  if (scope.kind === "office") return;
  const year = await findCurrentYear(db, schoolId);
  const [current] = year
    ? await db
        .select({ sectionId: enrollments.sectionId, status: enrollments.status })
        .from(enrollments)
        .where(and(eq(enrollments.studentId, studentId), eq(enrollments.schoolYearId, year.id)))
    : [];
  const mine = current?.status === "activa" && scope.sectionIds.includes(current.sectionId);
  const unenrolled = current?.status !== "activa";
  if (mine || (!edit && unenrolled)) return;
  throw forbidden(
    edit ? "Solo puedes cambiar los datos de alumnos de tus secciones" : "Ese alumno no es de tus secciones",
  );
}
