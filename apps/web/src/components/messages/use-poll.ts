"use client";

import { useEffect, useRef } from "react";
import { activityHeaders } from "@/lib/activity";
import { MESSAGES_CHANGED } from "./format";

/**
 * Consulta cada `intervalMs` mientras la página está a la vista (con la pantalla apagada o en otra
 * pestaña no gasta datos) y en cuanto vuelve a estar a la vista. También cuando otra parte del panel
 * avisa que cambiaron los mensajes.
 */
export function usePoll(task: () => Promise<void>, intervalMs: number) {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await latest.current();
      } catch {
        // Sin conexión o el servidor no respondió: se intenta en la próxima vuelta.
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(MESSAGES_CHANGED, tick);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(MESSAGES_CHANGED, tick);
      window.removeEventListener("online", tick);
    };
  }, [intervalMs]);
}

/** Lee JSON de las rutas del panel; si la sesión venció del todo, recarga para volver a entrar. */
export async function fetchPanelJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    cache: "no-store",
    // La consulta no es actividad: se informa la última vez que la persona tocó el panel.
    headers: { accept: "application/json", ...activityHeaders() },
  });
  if (res.redirected || res.status === 401) {
    window.location.reload();
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}
