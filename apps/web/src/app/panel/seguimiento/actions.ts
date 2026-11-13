"use server";

import { followUpInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

/** Anotar qué se hizo con un alumno en riesgo (el id del formulario es el del alumno). */
export async function addFollowUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador");
  const studentId = z.uuid().parse(formData.get("id"));
  return runFormAction(formData, {
    schema: followUpInputSchema,
    fields: ["kind", "date", "notes"],
    submit: async (input) => {
      await academic.addFollowUp(accessToken, studentId, input);
      revalidatePath("/panel/seguimiento");
      revalidatePath(`/panel/alumnos/${studentId}`);
      return "Seguimiento registrado.";
    },
  });
}

export async function deleteFollowUpAction(formData: FormData) {
  const { accessToken } = await requireRole("admin", "coordinador");
  const id = z.uuid().parse(formData.get("id"));
  const studentId = z.uuid().parse(formData.get("studentId"));
  await academic.deleteFollowUp(accessToken, id);
  revalidatePath(`/panel/alumnos/${studentId}`);
  revalidatePath("/panel/seguimiento");
}
