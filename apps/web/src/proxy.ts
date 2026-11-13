import type { TokenPairDto } from "@escolar/shared";
import { decodeJwt } from "jose";
import { type NextRequest, NextResponse } from "next/server";
import { identityUrl } from "./lib/config";
import { contentSecurityPolicy } from "./lib/csp";
import { ACCESS_COOKIE, cookieOptions, REFRESH_COOKIE } from "./lib/session-cookies";

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

function toLogin(request: NextRequest, expired: boolean) {
  const url = new URL("/login", request.url);
  if (expired) url.searchParams.set("expirada", "1");
  const response = NextResponse.redirect(url);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
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
    return isFresh(access) ? NextResponse.redirect(new URL("/panel", request.url)) : pass(request);
  }

  if (isFresh(access)) return pass(request);
  if (!refreshToken) return toLogin(request, Boolean(access));

  const pair = await refresh(refreshToken);
  if (!pair) return toLogin(request, true);

  request.cookies.set(ACCESS_COOKIE, pair.accessToken);
  request.cookies.set(REFRESH_COOKIE, pair.refreshToken);
  const response = pass(request);
  response.cookies.set(ACCESS_COOKIE, pair.accessToken, cookieOptions(pair.expiresIn));
  response.cookies.set(REFRESH_COOKIE, pair.refreshToken, cookieOptions(pair.refreshExpiresIn));
  return response;
}

export const config = {
  matcher: ["/panel/:path*", "/login"],
};
