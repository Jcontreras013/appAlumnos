import { conflict } from "@escolar/service-kit";
import { and, eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { type Enrollment, enrollments, schoolYears } from "../db/schema";
import { countActive, getSection, lockSection } from "./queries";

/**
 * Matricula a un alumno en una sección, respetando el cupo.
 *
 * La fila de la sección se bloquea (SELECT ... FOR UPDATE) antes de contar: si dos personas
 * matriculan en la misma sección a la vez, la segunda espera a que la primera termine y cuenta
 * con el dato real. Sin el bloqueo, las dos verían "queda 1 cupo" y la sección quedaría sobrevendida.
 *
 * Si el alumno había sido retirado ese mismo año, la matrícula se reactiva en vez de duplicarse.
 */
export async function enrollStudent(
  tx: Tx,
  input: { schoolId: string; studentId: string; sectionId: string; today: string },
): Promise<{ enrollment: Enrollment; reactivated: boolean }> {
  const section = await lockSection(tx, input.schoolId, input.sectionId);
  const info = await getSection(tx, input.schoolId, section.id);

  const [existing] = await tx
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.studentId, input.studentId), eq(enrollments.schoolYearId, section.schoolYearId)),
    );
  if (existing?.status === "activa") {
    const [year] = await tx.select().from(schoolYears).where(eq(schoolYears.id, section.schoolYearId));
    const current = await getSection(tx, input.schoolId, existing.sectionId);
    throw conflict(
      `El alumno ya está matriculado en ${current.label} para el año ${year?.name ?? ""}`.trim(),
    );
  }

  if (section.capacity !== null && (await countActive(tx, section.id)) >= section.capacity) {
    throw conflict(`${info.label} está llena (cupo de ${section.capacity} alumnos)`);
  }

  if (existing) {
    const [enrollment] = await tx
      .update(enrollments)
      .set({
        status: "activa",
        sectionId: section.id,
        enrolledOn: input.today,
        withdrawnOn: null,
        withdrawReason: null,
      })
      .where(eq(enrollments.id, existing.id))
      .returning();
    if (!enrollment) throw new Error("No se pudo reactivar la matrícula");
    return { enrollment, reactivated: true };
  }

  const [enrollment] = await tx
    .insert(enrollments)
    .values({
      schoolId: input.schoolId,
      studentId: input.studentId,
      schoolYearId: section.schoolYearId,
      sectionId: section.id,
      enrolledOn: input.today,
    })
    .returning();
  if (!enrollment) throw new Error("No se pudo crear la matrícula");
  return { enrollment, reactivated: false };
}
