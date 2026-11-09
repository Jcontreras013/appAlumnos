"use server";

import { leaveInputSchema, substitutionInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

const writer = () => requireRole("admin", "coordinador");
const done = (message: string) => {
  revalidatePath("/panel/licencias");
  return message;
};

export async function createLeaveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: leaveInputSchema,
    fields: ["teacherUserId", "type", "startsOn", "endsOn", "notes"],
    submit: async (input) => {
      const leave = await academic.createLeave(accessToken, input);
      const pending = leave.classes.length;
      return done(
        pending > 0
          ? `Licencia registrada. ${leave.teacherName} tiene ${pending} ${pending === 1 ? "clase" : "clases"}: asígnales sustituto abajo.`
          : `Licencia registrada para ${leave.teacherName}.`,
      );
    },
  });
}

export async function addSubstitutionAction(
  leaveId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: substitutionInputSchema,
    fields: ["assignmentId", "substituteUserId", "startsOn", "endsOn"],
    submit: async (input) => {
      const leave = await academic.addSubstitution(accessToken, leaveId, input);
      const sub = leave.classes.find((c) => c.assignment.id === input.assignmentId)?.substitution;
      return done(`${sub?.substituteName ?? "El sustituto"} cubrirá la clase.`);
    },
  });
}

export async function cancelLeaveAction(formData: FormData) {
  const { accessToken } = await writer();
  await academic.cancelLeave(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/licencias");
}

export async function cancelSubstitutionAction(formData: FormData) {
  const { accessToken } = await writer();
  await academic.cancelSubstitution(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/licencias");
}

/** En primaria el maestro de grado da todas las materias: un mismo sustituto cubre todo de una vez. */
export async function coverAllAction(
  leaveId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  const parsed = z.uuid().safeParse(formData.get("substituteUserId"));
  if (!parsed.success)
    return { error: "Elige quién cubre", fields: { substituteUserId: "Elige quién cubre" } };
  const leave = (await academic.listLeaves(accessToken)).find((l) => l.id === leaveId);
  const pending = leave?.classes.filter((c) => !c.substitution) ?? [];
  let covered = 0;
  for (const c of pending) {
    try {
      await academic.addSubstitution(accessToken, leaveId, {
        assignmentId: c.assignment.id,
        substituteUserId: parsed.data,
      });
      covered++;
    } catch (err) {
      revalidatePath("/panel/licencias");
      const message = err instanceof Error ? err.message : "No se pudo asignar";
      return { error: covered ? `Se cubrieron ${covered} clases; luego falló: ${message}` : message };
    }
  }
  return {
    ok: true,
    message: done(`Listo: ${covered} ${covered === 1 ? "clase cubierta" : "clases cubiertas"}.`),
  };
}
