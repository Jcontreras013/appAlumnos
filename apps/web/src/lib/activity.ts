"use client";

import { ACTIVITY_HEADER, ACTIVITY_STORAGE_KEY } from "./session-cookies";

/** Última vez que la persona tocó el panel en este navegador (compartida entre pestañas). */
export function lastActivity(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveActivity(at: number) {
  try {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    // Sin almacenamiento: el servidor solo conoce las páginas que se abren.
  }
}

/**
 * Encabezado para las peticiones que hace la página sola (consultas, sincronización del cuaderno):
 * le dice al servidor cuándo fue la última actividad real, para que no cuenten como actividad ni
 * cierren la sesión de quien trabajó sin señal.
 */
export function activityHeaders(): Record<string, string> {
  const at = lastActivity();
  return at ? { [ACTIVITY_HEADER]: String(at) } : {};
}
