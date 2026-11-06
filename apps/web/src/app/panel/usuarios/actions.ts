"use server";

import { createUserInputSchema, ROLE_LABELS } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError } from "@/lib/forms";
import { identity } from "@/lib/identity";

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  const values = formValues(formData, ["name", "email", "role"]);
  const parsed = createUserInputSchema.safeParse({ ...values, password: formData.get("password") });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };

  try {
    const user = await identity.createUser(session.accessToken, parsed.data);
    revalidatePath("/panel/usuarios");
    return { ok: true, message: `Se creó la cuenta de ${user.name} (${ROLE_LABELS[user.role]}).` };
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
}

const toggleSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

export async function setUserActiveAction(formData: FormData) {
  const session = await requireRole("admin");
  const { id, active } = toggleSchema.parse({ id: formData.get("id"), active: formData.get("active") });
  await identity.setUserActive(session.accessToken, id, active === "true");
  revalidatePath("/panel/usuarios");
}
