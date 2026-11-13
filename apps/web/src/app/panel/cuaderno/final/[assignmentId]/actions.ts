"use server";

import { recoveriesInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError } from "@/lib/forms";

/** Cada alumno que puede recuperar trae un campo r-<studentId> (vacío = sin nota de recuperación). */
export async function saveRecoveriesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("docente", "admin", "coordinador");
  const assignmentId = z.uuid().parse(formData.get("assignmentId"));
  const entries = [...formData.entries()].flatMap(([key, value]) => {
    const match = /^r-([0-9a-f-]{36})$/.exec(key);
    if (!match) return [];
    const text = String(value).trim().replace(",", ".");
    return [{ studentId: match[1] as string, score: text === "" ? null : Number(text) }];
  });
  if (entries.length === 0) return { error: "No hay alumnos en recuperación en esta clase" };
  const parsed = recoveriesInputSchema.safeParse({ entries });
  if (!parsed.success) return { error: "Las notas de recuperación van de 0 a 100" };
  try {
    await academic.saveRecoveries(accessToken, assignmentId, parsed.data);
    revalidatePath(`/panel/cuaderno/final/${assignmentId}`);
    return { ok: true, message: "Notas de recuperación guardadas." };
  } catch (err) {
    return fromServiceError(err);
  }
}
