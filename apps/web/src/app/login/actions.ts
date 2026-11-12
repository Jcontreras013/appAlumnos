"use server";

import { isMfaChallenge, loginInputSchema } from "@escolar/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError } from "@/lib/forms";
import { identity } from "@/lib/identity";
import { setSessionCookies } from "@/lib/session";
import { cookieOptions, MFA_COOKIE } from "@/lib/session-cookies";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["email"]);
  const parsed = loginInputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };

  let needsCode = false;
  try {
    const result = await identity.login(parsed.data.email, parsed.data.password);
    if (isMfaChallenge(result)) {
      // La contraseña estuvo bien; falta el código de la app (segundo paso).
      (await cookies()).set(MFA_COOKIE, result.challenge, { ...cookieOptions(5 * 60), path: "/login" });
      needsCode = true;
    } else {
      await setSessionCookies(result);
    }
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  redirect(needsCode ? "/login/verificar" : "/panel");
}
