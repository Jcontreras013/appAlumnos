"use server";

import {
  accountUpdateSchema,
  changePasswordInputSchema,
  mfaCodeInputSchema,
  type PasswordResetDto,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { getSession, requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError, runFormAction } from "@/lib/forms";
import { identity } from "@/lib/identity";
import { qrPath } from "@/lib/qr";
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

/**
 * Corregir nombre, identidad o correo de alguien del ámbito (la dirección, a su personal; la
 * distrital o departamental, a los centros de su ámbito). identity revisa el permiso.
 */
export async function updateAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin", "director_distrital", "director_departamental", "superadmin");
  const id = String(formData.get("id") ?? "");
  return runFormAction(formData, {
    schema: accountUpdateSchema,
    fields: ["name", "nationalId", "email"],
    submit: async (input) => {
      const user = await identity.updateAccount(session.accessToken, id, input);
      // Las clases y licencias del centro guardan una copia del nombre del docente.
      await (session.user.role === "admin"
        ? academic.refreshPersonName(session.accessToken, id)
        : academic.refreshPersonNameInScope(session.accessToken, id)
      ).catch(() => {});
      revalidatePath("/panel", "layout");
      return `Datos de ${user.name} guardados.`;
    },
  });
}

// ── Verificación en dos pasos ──

export interface MfaSetupState {
  setup?: { secret: string; qr: { size: number; d: string } };
  error?: string;
}

/** Clave nueva para la app del teléfono, con su código QR. */
export async function startMfaSetupAction(): Promise<MfaSetupState> {
  const { accessToken } = await getSession();
  try {
    const setup = await identity.setupMfa(accessToken);
    return { setup: { secret: setup.secret, qr: qrPath(setup.otpauthUrl) } };
  } catch (err) {
    return { error: fromServiceError(err).error };
  }
}

export interface MfaEnableState {
  error?: string;
  recoveryCodes?: string[];
}

/**
 * Activarla con el primer código de la app. No se refresca la página aquí: primero se muestran los
 * códigos de recuperación (una sola vez) y la persona sigue cuando los guardó.
 */
export async function enableMfaAction(_prev: MfaEnableState, formData: FormData): Promise<MfaEnableState> {
  const { accessToken } = await getSession();
  const parsed = mfaCodeInputSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    return { recoveryCodes: (await identity.enableMfa(accessToken, parsed.data.code)).recoveryCodes };
  } catch (err) {
    return { error: fromServiceError(err).error };
  }
}

/** Equipo de la plataforma: quitar la verificación de alguien que perdió el teléfono y sus códigos. */
export async function resetMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("superadmin");
  return runFormAction(formData, {
    schema: z.object({ login: z.string().trim().min(3, { error: "Escribe el correo o la identidad" }) }),
    fields: ["login"],
    submit: async ({ login }) => {
      await identity.resetMfa(accessToken, login);
      return `Listo: ${login} vuelve a entrar solo con su contraseña y activa la verificación de nuevo.`;
    },
  });
}
