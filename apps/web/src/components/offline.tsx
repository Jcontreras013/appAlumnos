"use client";

import { useEffect, useState } from "react";
import { clearCachedPages, precachePages, registerServiceWorker } from "@/lib/offline/sw-client";
import { dismissFailures, flush, startSync, useSync } from "@/lib/offline/sync";

/** Arranca el modo sin internet en el panel: service worker y envío de cambios pendientes. */
export function OfflineAgent({ owner }: { owner: string }) {
  useEffect(() => {
    startSync(owner);
    void registerServiceWorker();
  }, [owner]);
  return null;
}

/** En la pantalla de inicio de sesión: borra las páginas guardadas (dispositivos compartidos). */
export function ClearOfflinePages() {
  useEffect(() => clearCachedPages(), []);
  return null;
}

/** Guarda en el dispositivo las páginas de las clases del maestro para usarlas sin internet. */
export function PrecacheClasses({ urls }: { urls: string[] }) {
  const [state, setState] = useState<"guardando" | "listo" | "no-disponible">("guardando");
  const joined = urls.join("\n");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ready = await registerServiceWorker();
      if (!ready) {
        if (alive) setState("no-disponible");
        return;
      }
      const cached = await precachePages(joined.split("\n").filter(Boolean));
      if (alive) setState(cached === null ? "no-disponible" : "listo");
    })();
    return () => {
      alive = false;
    };
  }, [joined]);

  if (state === "no-disponible") return null;
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500" data-offline-ready={state === "listo"}>
      <span
        className={`size-2 rounded-full ${state === "listo" ? "bg-brand-500" : "animate-pulse bg-slate-300"}`}
        aria-hidden="true"
      />
      {state === "listo"
        ? "Listo para usar sin internet en este dispositivo"
        : "Guardando tus clases para usarlas sin internet…"}
    </p>
  );
}

const STATUS_TEXT = {
  listo: "Todo guardado",
  enviando: "Guardando…",
  "sin-conexion": "Sin conexión",
  sesion: "Inicia sesión de nuevo",
  error: "Reintentando…",
} as const;

/** Indicador de sincronización: cuántos cambios esperan en el dispositivo y si hubo rechazos. */
export function SyncStatus() {
  const sync = useSync();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const status = !online ? "sin-conexion" : sync.status;
  const tone =
    status === "listo" && sync.pending === 0
      ? "border-brand-100 bg-brand-50 text-brand-800"
      : status === "sesion"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className="space-y-2">
      <div
        role="status"
        aria-live="polite"
        data-sync-status={status}
        data-pending={sync.pending}
        className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${tone}`}
      >
        <span>{sync.pending > 0 && status === "listo" ? STATUS_TEXT.enviando : STATUS_TEXT[status]}</span>
        {sync.pending > 0 && (
          <span className="font-normal">
            · {sync.pending} {sync.pending === 1 ? "cambio guardado" : "cambios guardados"} en este
            dispositivo
            {status === "sin-conexion" ? ", se enviarán cuando vuelva el internet" : ""}
          </span>
        )}
        {status === "sesion" && (
          <a href="/login" className="underline">
            Entrar
          </a>
        )}
        {(status === "error" || status === "sin-conexion") && sync.pending > 0 && online && (
          <button type="button" className="underline" onClick={() => void flush()}>
            Reintentar
          </button>
        )}
      </div>
      {sync.failed.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p className="font-semibold">
            {sync.failed.length === 1
              ? "Un cambio no se pudo guardar"
              : `${sync.failed.length} cambios no se pudieron guardar`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(sync.failed.map((f) => f.message))].slice(0, 5).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                void dismissFailures().then(() => window.location.reload());
              }}
            >
              Entendido, ver lo que quedó guardado
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
