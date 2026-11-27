/**
 * La sesión vive en dos cookies httpOnly: el navegador nunca puede leer los tokens con
 * JavaScript (protege contra XSS). Next.js actúa como BFF y es el único que habla con los servicios.
 * Este archivo no usa APIs de servidor para poder importarse también desde `proxy.ts`.
 */
export const ACCESS_COOKIE = "esc_access";
export const REFRESH_COOKIE = "esc_refresh";
/** Desafío del segundo paso del inicio de sesión (verificación en dos pasos): dura 5 minutos. */
export const MFA_COOKIE = "esc_mfa";

/*
 * Cierre por inactividad. La última actividad de la persona (milisegundos) vive en una cookie httpOnly
 * que revisa el proxy en cada página del panel: si pasó más del límite, la sesión se cierra aunque la
 * app o la pestaña hayan estado cerradas (un temporizador en la página solo no basta: al volver a
 * abrirla empezaría de cero). Las peticiones del navegador informan en ACTIVITY_HEADER la última vez
 * que la persona tocó la pantalla, así las consultas automáticas no cuentan como actividad y un maestro
 * que trabajó sin señal en el cuaderno no pierde la sesión al reconectarse.
 */
export const ACTIVITY_COOKIE = "esc_activity";
export const ACTIVITY_HEADER = "x-conecta-actividad";
/** La guarda el navegador (compartida entre pestañas). */
export const ACTIVITY_STORAGE_KEY = "conecta-ultima-actividad";
/** La cookie dura más que la sesión: lo que manda es la hora guardada adentro. */
export const ACTIVITY_MAX_AGE_SECONDS = 30 * 24 * 3600;

/** Minutos sin usar el panel antes de cerrar la sesión (SESSION_IDLE_MINUTES, 30 por defecto). */
export function idleMinutes(): number {
  const value = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
  return Number.isFinite(value) && value >= 2 ? value : 30;
}

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
