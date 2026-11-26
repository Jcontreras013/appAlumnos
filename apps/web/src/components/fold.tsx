import type { ReactNode } from "react";

/**
 * Bloque desplegable: se ve el título con un resumen (cuántos hay, qué necesita atención) y se abre
 * al tocarlo. Para que las tablas largas no saturen la pantalla. Sin JavaScript (details/summary).
 */
export function Fold({
  title,
  summary,
  open = false,
  children,
  className = "",
}: {
  title: ReactNode;
  /** Lo que se ve sin abrirlo: cuántos, cuántos por revisar, etc. */
  summary?: ReactNode;
  open?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details open={open} className={`card group overflow-hidden ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-slate-900">{title}</span>
          {summary && (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{summary}</span>
          )}
        </span>
        <svg
          viewBox="0 0 20 20"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </summary>
      <div className="border-t border-slate-200">{children}</div>
    </details>
  );
}

/** Etiqueta pequeña para el resumen de un desplegable. */
export function FoldTag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "alert" | "ok";
}) {
  const color =
    tone === "alert"
      ? "bg-amber-50 text-amber-800"
      : tone === "ok"
        ? "bg-brand-50 text-brand-700"
        : "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2 py-0.5 font-medium ${color}`}>{children}</span>;
}
