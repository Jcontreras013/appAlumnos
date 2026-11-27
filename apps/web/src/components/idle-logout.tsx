"use client";

import { useEffect, useState } from "react";
import { idleLogoutAction } from "@/app/panel/actions";
import { activityHeaders, lastActivity, saveActivity } from "@/lib/activity";

const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
/** Cada cuánto, como mucho, se le avisa al servidor que la persona sigue usando la página. */
const BEAT_MS = 2 * 60_000;

/**
 * Cierra la sesión si nadie usa el panel durante `minutes` (una computadora compartida que quedó
 * abierta, un teléfono prestado). Lo hace cumplir el servidor (proxy.ts) aunque la app o la pestaña
 * hayan estado cerradas; aquí se avisa dos minutos antes, se cierra a tiempo con la página abierta y
 * se le cuenta al servidor que la persona sigue trabajando aunque no cambie de página (una
 * planificación larga). Las consultas automáticas no cuentan como actividad. Sin internet no se
 * cierra: el cuaderno funciona sin señal.
 */
export function IdleLogout({ minutes }: { minutes: number }) {
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    const limit = minutes * 60_000;
    let last = Date.now();
    let saved = 0;
    let beat = Date.now();
    let closing = false;
    const mark = () => {
      last = Date.now();
      // Se guarda cada tanto (no en cada movimiento) para que las otras pestañas lo sepan.
      if (last - saved > 15_000) {
        saved = last;
        saveActivity(last);
      }
    };
    const check = () => {
      if (closing) return;
      const now = Date.now();
      const latest = Math.max(last, lastActivity());
      const idle = now - latest;
      setWarning(idle > limit - 2 * 60_000 && idle < limit);
      if (!navigator.onLine) return;
      if (idle >= limit) {
        closing = true;
        void idleLogoutAction();
        return;
      }
      // «Sigo aquí»: hubo actividad desde el último aviso y ya pasó un rato.
      if (latest > beat && now - beat > BEAT_MS) {
        beat = now;
        saveActivity(latest);
        void fetch("/panel/sesion", {
          method: "POST",
          headers: { ...activityHeaders(), "x-conecta-latido": "1" },
          cache: "no-store",
          redirect: "manual",
        })
          .then((res) => {
            // El servidor ya cerró la sesión (por ejemplo, desde otro dispositivo): a la pantalla de entrada.
            if (res.type === "opaqueredirect" || res.status === 401) window.location.reload();
          })
          .catch(() => {});
      }
    };
    mark();
    saveActivity(last);
    for (const e of EVENTS) window.addEventListener(e, mark, { passive: true });
    // Al volver a la app o a la pestaña se revisa de inmediato (en segundo plano los relojes se pausan).
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    const timer = setInterval(check, 10_000);
    return () => {
      clearInterval(timer);
      for (const e of EVENTS) window.removeEventListener(e, mark);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, [minutes]);

  if (!warning) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg print:hidden"
    >
      <span>Por seguridad, tu sesión se cerrará en unos minutos por inactividad.</span>
      <button type="button" className="btn-primary px-3 py-1.5" onClick={() => setWarning(false)}>
        Seguir conectado
      </button>
    </div>
  );
}
