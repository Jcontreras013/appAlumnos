"use server";

import { disciplineInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

const FIELDS = [
  "kind",
  "severity",
  "date",
  "description",
  "measure",
  "suspensionFrom",
  "suspensionTo",
  "notifyFamily",
] as const;

/** Registrar un llamado de atención o una medida (el campo «id» es el alumno). */
export async function addDisciplineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador", "docente");
  const studentId = z.uuid().safeParse(formData.get("id"));
  if (!studentId.success) {
    return { error: "Elige al alumno", fields: { id: "Elige al alumno" } };
  }
  return runFormAction(formData, {
    schema: disciplineInputSchema,
    fields: FIELDS,
    submit: async (input) => {
      const saved = await academic.addDiscipline(accessToken, studentId.data, input);
      revalidatePath("/panel/disciplina");
      revalidatePath(`/panel/alumnos/${studentId.data}`);
      return input.kind === "expulsion"
        ? `Expulsión registrada: se retiró la matrícula de ${saved.studentName}.`
        : `Registrado para ${saved.studentName}.`;
    },
  });
}

export async function deleteDisciplineAction(formData: FormData) {
  const { accessToken } = await requireRole("admin", "coordinador", "docente");
  const id = z.uuid().parse(formData.get("id"));
  const studentId = z.uuid().parse(formData.get("studentId"));
  await academic.deleteDiscipline(accessToken, id);
  revalidatePath("/panel/disciplina");
  revalidatePath(`/panel/alumnos/${studentId}`);
}
