"use server";

import { receiveTransferSchema, transferInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

const office = () => requireRole("admin", "secretaria");

/** Trasladar a un alumno a otro centro del departamento (el id del formulario es el del alumno). */
export async function sendTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await office();
  const studentId = z.uuid().parse(formData.get("studentId"));
  return runFormAction(formData, {
    schema: transferInputSchema,
    fields: ["toSchoolId", "date", "notes"],
    submit: async (input) => {
      const sent = await academic.sendTransfer(accessToken, studentId, input);
      revalidatePath(`/panel/alumnos/${studentId}`);
      return `Traslado registrado: ${sent.toSchoolName} lo verá en «Traslados» para recibirlo.`;
    },
  });
}

export async function receiveTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await office();
  const id = z.uuid().parse(formData.get("id"));
  let studentId: string | null = null;
  const state = await runFormAction(formData, {
    schema: receiveTransferSchema,
    fields: ["sectionId"],
    submit: async ({ sectionId }) => {
      studentId = (await academic.receiveTransfer(accessToken, id, sectionId)).studentId;
      revalidatePath("/panel/traslados");
      return "Recibido.";
    },
  });
  if (state.ok && studentId) redirect(`/panel/alumnos/${studentId}`);
  return state;
}

export async function cancelTransferAction(formData: FormData) {
  const { accessToken } = await office();
  const transfer = await academic.cancelTransfer(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/traslados");
  if (transfer.studentId) revalidatePath(`/panel/alumnos/${transfer.studentId}`);
}
