"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { identity } from "@/lib/identity";
import { clearSessionCookies } from "@/lib/session";
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
