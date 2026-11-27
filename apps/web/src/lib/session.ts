import "server-only";
import type { TokenPairDto } from "@escolar/shared";
import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  ACTIVITY_COOKIE,
  ACTIVITY_MAX_AGE_SECONDS,
  cookieOptions,
  REFRESH_COOKIE,
} from "./session-cookies";

export async function setSessionCookies(pair: TokenPairDto) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, pair.accessToken, cookieOptions(pair.expiresIn));
  jar.set(REFRESH_COOKIE, pair.refreshToken, cookieOptions(pair.refreshExpiresIn));
  // Entrar cuenta como actividad: empieza de cero el conteo de inactividad.
  jar.set(ACTIVITY_COOKIE, String(Date.now()), cookieOptions(ACTIVITY_MAX_AGE_SECONDS));
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(ACTIVITY_COOKIE);
}
