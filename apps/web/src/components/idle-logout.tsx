"use client";

import { useEffect, useState } from "react";
import { idleLogoutAction } from "@/app/panel/actions";

const KEY = "conecta-ultima-actividad";
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

const read = () => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
};

/**
 * Cierra la sesión del personal si nadie usa el panel durante `minutes` (una computadora compartida
 * que quedó abierta). Las consultas automáticas (mensajes nuevos) no cuentan como actividad. La
 * actividad se comparte entre pestañas, y sin internet no se cierra (el cuaderno funciona sin señal).
 * Dos minutos antes avisa, por si la persona sigue ahí.
 */
export function IdleLogout({ minutes }: { minutes: number }) {
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    const limit = minutes * 60_000;
    let last = Date.now();
    let saved = 0;
    const mark = () => {
      last = Date.now();
      // Se guarda cada tanto (no en cada movimiento) para que las otras pestañas lo sepan.
      if (last - saved > 15_000) {
        saved = last;
        try {
          localStorage.setItem(KEY, String(last));
        } catch {}
      }
    };
    mark();
    for (const e of EVENTS) window.addEventListener(e, mark, { passive: true });
    const timer = setInterval(() => {
      const idle = Date.now() - Math.max(last, read());
      setWarning(idle > limit - 2 * 60_000 && idle < limit);
      if (idle < limit || !navigator.onLine) return;
      clearInterval(timer);
      void idleLogoutAction();
    }, 10_000);
    return () => {
      clearInterval(timer);
      for (const e of EVENTS) window.removeEventListener(e, mark);
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
