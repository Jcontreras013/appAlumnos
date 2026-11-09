import type { ReactNode } from "react";

/** Indicador grande para tableros. `tone="alert"` lo resalta en rojo cuando hay un problema. */
export function Kpi({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: ReactNode;
  tone?: "neutral" | "alert" | "ok";
}) {
  const styles = {
    neutral: "border-slate-200 bg-white",
    alert: "border-red-200 bg-red-50",
    ok: "border-brand-100 bg-brand-50",
  }[tone];
  const valueColor = { neutral: "text-slate-900", alert: "text-red-700", ok: "text-brand-700" }[tone];
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${styles}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
