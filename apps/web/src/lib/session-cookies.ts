/**
 * La sesión vive en dos cookies httpOnly: el navegador nunca puede leer los tokens con
 * JavaScript (protege contra XSS). Next.js actúa como BFF y es el único que habla con los servicios.
 * Este archivo no usa APIs de servidor para poder importarse también desde `proxy.ts`.
 */
export const ACCESS_COOKIE = "esc_access";
export const REFRESH_COOKIE = "esc_refresh";
/** Desafío del segundo paso del inicio de sesión (verificación en dos pasos): dura 5 minutos. */
export const MFA_COOKIE = "esc_mfa";

export function cookieOptions(maxAgeSeconds: number) {
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // En producción siempre HTTPS. COOKIE_SECURE=false solo para probar `next start` en local.
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
