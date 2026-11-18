"use client";

import { type ComponentProps, type ReactNode, useId, useRef } from "react";
import { Kpi } from "@/components/kpi";

/**
 * Indicador que se puede tocar: abre un cuadro flotante con lo que hay detrás del número (quiénes
 * son los alumnos en riesgo, qué clases están sin maestro…). Es un <dialog> nativo: se cierra con
 * Esc, con «Cerrar» o tocando fuera del cuadro.
 */
export function KpiPanel({
  title,
  subtitle,
  cta = "Ver detalle →",
  children,
  ...kpi
}: ComponentProps<typeof Kpi> & { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className="block h-full w-full rounded-xl text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <Kpi {...kpi} cta={cta} />
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: el clic en el fondo es un atajo; con teclado se cierra con Esc, que <dialog> ya trae */}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        // Un toque fuera del cuadro (en el fondo oscuro) lo cierra.
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
        className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="btn-secondary shrink-0 px-3 py-1.5"
            >
              Cerrar
            </button>
          </div>
          <div className="overflow-y-auto">{children}</div>
        </div>
      </dialog>
    </>
  );
}
