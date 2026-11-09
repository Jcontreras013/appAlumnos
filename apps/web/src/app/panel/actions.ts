"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/dal";
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
