"use server";

import { mfaLoginInputSchema } from "@escolar/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { fromServiceError } from "@/lib/forms";
import { identity } from "@/lib/identity";
import { setSessionCookies } from "@/lib/session";
import { MFA_COOKIE } from "@/lib/session-cookies";

/** Segundo paso: el código de la app (o uno de recuperación) abre la sesión. */
export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const jar = await cookies();
  const challenge = jar.get(MFA_COOKIE)?.value;
  if (!challenge) redirect("/login?expirada=1");
  const parsed = mfaLoginInputSchema.safeParse({ challenge, code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Escribe el código" };
  try {
    const session = await identity.loginMfa(parsed.data.challenge, parsed.data.code);
    await setSessionCookies(session);
    jar.delete({ name: MFA_COOKIE, path: "/login" });
  } catch (err) {
    return fromServiceError(err);
  }
  redirect("/panel");
}
