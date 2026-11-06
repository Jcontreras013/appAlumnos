"use server";

import { loginInputSchema } from "@escolar/shared";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError } from "@/lib/forms";
import { identity } from "@/lib/identity";
import { setSessionCookies } from "@/lib/session";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = loginInputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };

  try {
    const session = await identity.login(parsed.data.email, parsed.data.password);
    await setSessionCookies(session);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  redirect("/panel");
}
