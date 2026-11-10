"use server";

import { changePasswordInputSchema, type PasswordResetDto } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError } from "@/lib/forms";
import { identity } from "@/lib/identity";
import { clearSessionCookies, setSessionCookies } from "@/lib/session";
import { REFRESH_COOKIE } from "@/lib/session-cookies";

export async function logoutAction() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    // Si el servicio no responde igual se borran las cookies: cerrar sesión nunca debe fallar.
    await identity.logout(refreshToken).catch(() => {});
  }
  await clearSessionCookies();
  redirect("/login");
}

/** Cambiar de centro (o de rol) sin volver a escribir la contraseña. */
export async function switchMembershipAction(formData: FormData) {
  const { accessToken } = await getSession();
  const membershipId = String(formData.get("membershipId") ?? "");
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  const session = await identity.switchMembership(accessToken, membershipId, refreshToken);
  await setSessionCookies(session);
  redirect("/panel");
}

/** Cambiar la contraseña propia (obligatorio si el centro entregó una temporal). */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await getSession();
  const values = formValues(formData, ["currentPassword", "newPassword", "confirmPassword"]);
  const parsed = changePasswordInputSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values: {} };
  if (values.newPassword !== values.confirmPassword) {
    return {
      error: "Revisa los campos marcados",
      fields: { confirmPassword: "No coincide con la contraseña nueva" },
    };
  }
  try {
    await identity.changePassword(accessToken, parsed.data);
  } catch (err) {
    return { ...fromServiceError(err), values: {} };
  }
  revalidatePath("/panel", "layout");
  // Si era la contraseña temporal del primer ingreso, se entra directo al panel.
  if (formData.get("temporary") === "1") redirect("/panel");
  return { ok: true, message: "Listo: tu contraseña quedó cambiada." };
}

export interface ResetPasswordState {
  error?: string;
  reset?: PasswordResetDto;
}

/** Contraseña temporal para alguien del ámbito de quien la pide (identity revisa el permiso). */
export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const { accessToken } = await getSession();
  const userId = String(formData.get("userId") ?? "");
  try {
    return { reset: await identity.resetPassword(accessToken, userId) };
  } catch (err) {
    return { error: fromServiceError(err).error };
  }
}
