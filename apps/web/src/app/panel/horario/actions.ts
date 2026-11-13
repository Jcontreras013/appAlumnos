"use server";

import { scheduleBlocksInputSchema, sectionScheduleInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError } from "@/lib/forms";

const writer = () => requireRole("admin", "coordinador");

/** Horas de clase: dos columnas (inicio y fin) en el orden del formulario. */
export async function saveBlocksAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  const starts = formData.getAll("startsAt").map(String);
  const ends = formData.getAll("endsAt").map(String);
  const blocks = starts
    .map((startsAt, i) => ({ startsAt, endsAt: ends[i] ?? "" }))
    .filter((b) => b.startsAt || b.endsAt);
  const parsed = scheduleBlocksInputSchema.safeParse({ blocks });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa las horas" };
  try {
    await academic.saveScheduleBlocks(accessToken, parsed.data);
    revalidatePath("/panel/horario");
    return { ok: true, message: `Horas de clase guardadas (${blocks.length}).` };
  } catch (err) {
    return fromServiceError(err);
  }
}

/** Horario de una sección: cada casilla se llama c-<día>-<hora> y trae la clase elegida (o vacío). */
export async function saveSectionScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  const sectionId = z.uuid().parse(formData.get("sectionId"));
  const slots = [...formData.entries()].flatMap(([key, value]) => {
    const match = /^c-(\d)-(\d{1,2})$/.exec(key);
    return match && value
      ? [{ weekday: Number(match[1]), block: Number(match[2]), assignmentId: String(value) }]
      : [];
  });
  const parsed = sectionScheduleInputSchema.safeParse({ slots });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa el horario" };
  try {
    const saved = await academic.saveSectionSchedule(accessToken, sectionId, parsed.data);
    revalidatePath("/panel/horario");
    return { ok: true, message: `Horario guardado: ${saved.slots.length} horas de clase a la semana.` };
  } catch (err) {
    return fromServiceError(err);
  }
}
