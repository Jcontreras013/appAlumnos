import type { TokenPairDto } from "@escolar/shared";
import { decodeJwt } from "jose";
import { type NextRequest, NextResponse } from "next/server";
import { identityUrl } from "./lib/config";
import { contentSecurityPolicy } from "./lib/csp";
import {
  ACCESS_COOKIE,
  ACTIVITY_COOKIE,
  ACTIVITY_HEADER,
  ACTIVITY_MAX_AGE_SECONDS,
  cookieOptions,
  idleMinutes,
  REFRESH_COOKIE,
} from "./lib/session-cookies";

/** Si al access token le quedan menos de estos segundos, se renueva antes de llegar a la página. */
const REFRESH_MARGIN_SECONDS = 30;

function isFresh(token: string | undefined): boolean {
  if (!token) return false;
  try {
    // Solo se lee la expiración; la firma la verifica el servicio de identidad en cada llamada.
    const { exp } = decodeJwt(token);
    return typeof exp === "number" && exp - Date.now() / 1000 > REFRESH_MARGIN_SECONDS;
  } catch {
    return false;
  }
}

async function refresh(refreshToken: string): Promise<TokenPairDto | null> {
  try {
    const res = await fetch(`${identityUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? ((await res.json()) as TokenPairDto) : null;
  } catch {
    return null;
  }
}

function toLogin(request: NextRequest, reason: "expirada" | "inactiva" | null) {
  const url = new URL("/login", request.url);
  if (reason) url.searchParams.set(reason, "1");
  const response = NextResponse.redirect(url);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  response.cookies.delete(ACTIVITY_COOKIE);
  return response;
}

/** Cierra la sesión en identity (el refresh token deja de servir) sin esperar más de 3 s. */
async function revoke(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await fetch(`${identityUrl()}/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  }).catch(() => {});
}

/**
 * Consultas que hace la página sola (mensajes nuevos, chat de la clase, prefetch de enlaces): no son
 * la persona usando el panel, así que no alargan la sesión; solo informan la última actividad real.
 */
function isBackground(request: NextRequest): boolean {
  if (request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch")
    return true;
  if (request.headers.get("x-conecta-latido")) return true;
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("application/json");
}

/** Última actividad conocida: la de la cookie o la que informa el navegador (nunca en el futuro). */
function lastActivity(request: NextRequest, now: number) {
  const known = Number(request.cookies.get(ACTIVITY_COOKIE)?.value) || 0;
  const claimed = Number(request.headers.get(ACTIVITY_HEADER)) || 0;
  return { known, last: Math.max(known, claimed > 0 && claimed <= now ? claimed : 0) };
}

/**
 * Sigue hacia la página con la política de contenido de esta respuesta: un `nonce` nuevo por petición
 * que Next.js pone en sus propios scripts (lo lee del encabezado de la petición), así ningún script
 * inyectado en la página puede correr. Solo en producción: en desarrollo, React necesita `eval`.
 */
function pass(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  const policy =
    process.env.NODE_ENV === "production" ? contentSecurityPolicy(btoa(crypto.randomUUID())) : null;
  if (policy) headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  if (policy) response.headers.set("content-security-policy", policy);
  return response;
}

/**
 * Renovación transparente de la sesión. El access token dura 15 minutos; cuando está por vencer,
 * se cambia el refresh token por uno nuevo (rotación) antes de renderizar, y los tokens nuevos se
 * pasan tanto al navegador (Set-Cookie) como a la petición en curso.
 */
export async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (request.nextUrl.pathname.startsWith("/login")) {
    const now = Date.now();
    const { known } = lastActivity(request, now);
    const idle = known > 0 && now - known > idleMinutes() * 60_000;
    return isFresh(access) && !idle ? NextResponse.redirect(new URL("/panel", request.url)) : pass(request);
  }

  // Sin usar el panel más del límite: la sesión se cierra, aunque la app haya estado cerrada.
  const now = Date.now();
  const { known, last } = lastActivity(request, now);
  if ((access || refreshToken) && known > 0 && now - last > idleMinutes() * 60_000) {
    await revoke(refreshToken);
    return toLogin(request, "inactiva");
  }
  // Lo que la persona hace (abrir una página, guardar) es actividad; las consultas automáticas, no.
  const activity = isBackground(request) ? last : now;
  const touch = (response: NextResponse) => {
    if (activity !== known) {
      response.cookies.set(ACTIVITY_COOKIE, String(activity), cookieOptions(ACTIVITY_MAX_AGE_SECONDS));
    }
    return response;
  };

  if (isFresh(access)) return touch(pass(request));
  if (!refreshToken) return toLogin(request, access ? "expirada" : null);

  const pair = await refresh(refreshToken);
  if (!pair) return toLogin(request, "expirada");

  request.cookies.set(ACCESS_COOKIE, pair.accessToken);
  request.cookies.set(REFRESH_COOKIE, pair.refreshToken);
  const response = pass(request);
  response.cookies.set(ACCESS_COOKIE, pair.accessToken, cookieOptions(pair.expiresIn));
  response.cookies.set(REFRESH_COOKIE, pair.refreshToken, cookieOptions(pair.refreshExpiresIn));
  return touch(response);
}

export const config = {
  matcher: ["/panel/:path*", "/login"],
};
