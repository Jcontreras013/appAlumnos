import "server-only";
import type { TokenPairDto } from "@escolar/shared";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, cookieOptions, REFRESH_COOKIE } from "./session-cookies";

export async function setSessionCookies(pair: TokenPairDto) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, pair.accessToken, cookieOptions(pair.expiresIn));
  jar.set(REFRESH_COOKIE, pair.refreshToken, cookieOptions(pair.refreshExpiresIn));
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}
