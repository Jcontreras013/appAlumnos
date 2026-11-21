"use server";

import { DAY_OFF_LABELS, dayOffInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

/** La secretaría y la dirección marcan el calendario escolar. */
const editor = () => requireRole("admin", "secretaria");

export async function addDayOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  return runFormAction(formData, {
    schema: dayOffInputSchema,
    fields: ["name", "kind", "startsOn", "endsOn"],
    build: (v) => ({ ...v, endsOn: v.endsOn || undefined }),
    submit: async (input) => {
      const day = await academic.addDayOff(accessToken, input);
      revalidatePath("/panel", "layout");
      return `Listo: «${day.name}» (${DAY_OFF_LABELS[day.kind].toLowerCase()}) quedó en el calendario.`;
    },
  });
}

export async function removeDayOffAction(formData: FormData) {
  const { accessToken } = await editor();
  await academic.removeDayOff(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel", "layout");
}
