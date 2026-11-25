import { type AccessClaims, notFound } from "@escolar/service-kit";
import type { AssignmentDto, ClassViewer } from "@escolar/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { enrollments } from "../db/schema";
import { canGrade } from "./evaluation";
import { childrenOf, studentOf } from "./family";
import { findCurrentYear, listAssignments } from "./queries";

export interface ClassAccess {
  assignment: AssignmentDto;
  viewer: ClassViewer;
  /** Publica temas, avisos, tareas y exámenes, y califica. */
  canEdit: boolean;
  /** Alumnos de la clase a nombre de los que mira (el propio alumno o los hijos de la familia). */
  studentIds: string[];
}

/** Alumnos (de la lista dada) con matrícula activa en la sección este año. */
async function enrolledIn(
  db: DbOrTx,
  schoolId: string,
  sectionId: string,
  schoolYearId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  const rows = await db
    .select({ studentId: enrollments.studentId })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sectionId, sectionId),
        eq(enrollments.schoolYearId, schoolYearId),
        eq(enrollments.status, "activa"),
        inArray(enrollments.studentId, ids),
      ),
    );
  return rows.map((r) => r.studentId);
}

/**
 * Quién puede entrar a una clase del año vigente y qué puede hacer: el maestro (o quien lo sustituye
 * hoy), la dirección y la coordinación la editan; la secretaría la ve; el alumno de esa sección y su
 * familia la ven. A cualquier otro se le responde como si no existiera.
 */
export async function classAccess(
  db: DbOrTx,
  auth: AccessClaims,
  assignmentId: string,
  today: string,
): Promise<ClassAccess> {
  const schoolId = auth.schoolId;
  if (!schoolId) throw notFound("Clase no encontrada");
  const year = await findCurrentYear(db, schoolId);
  const assignment = year
    ? (await listAssignments(db, schoolId, { schoolYearId: year.id })).find((a) => a.id === assignmentId)
    : undefined;
  if (!year || !assignment) throw notFound("Clase no encontrada");

  if (auth.role === "estudiante" || auth.role === "padre") {
    const candidates =
      auth.role === "estudiante"
        ? [await studentOf(db, schoolId, auth.userId)].filter((s): s is string => s !== null)
        : await childrenOf(db, schoolId, auth.userId);
    const studentIds = await enrolledIn(db, schoolId, assignment.sectionId, year.id, candidates);
    if (!studentIds.length) throw notFound("Clase no encontrada");
    return {
      assignment,
      viewer: auth.role === "estudiante" ? "alumno" : "familia",
      canEdit: false,
      studentIds,
    };
  }
  if (auth.role === "secretaria") return { assignment, viewer: "oficina", canEdit: false, studentIds: [] };
  if (["admin", "coordinador", "docente"].includes(auth.role)) {
    const editable = await canGrade(db, auth, assignment, today);
    if (editable) return { assignment, viewer: "docente", canEdit: true, studentIds: [] };
  }
  throw notFound("Clase no encontrada");
}

/** Clases de la sección de un alumno este año (para el alumno y para su familia). */
export async function classesOfStudent(db: DbOrTx, schoolId: string, studentId: string) {
  const year = await findCurrentYear(db, schoolId);
  if (!year) return [];
  const [enrollment] = await db
    .select({ sectionId: enrollments.sectionId })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.studentId, studentId),
        eq(enrollments.schoolYearId, year.id),
        eq(enrollments.status, "activa"),
      ),
    );
  if (!enrollment) return [];
  return listAssignments(db, schoolId, { schoolYearId: year.id, sectionId: enrollment.sectionId });
}
