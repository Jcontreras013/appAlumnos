import { PLAN_STATUS_LABELS, type PlanStatus } from "@escolar/shared";

const STYLES: Record<PlanStatus | "sin_iniciar", string> = {
  sin_iniciar: "bg-slate-100 text-slate-600",
  borrador: "bg-slate-100 text-slate-800",
  enviada: "bg-sky-50 text-sky-800",
  devuelta: "bg-amber-50 text-amber-900",
  aprobada: "bg-brand-50 text-brand-700",
};

const SHORT: Record<PlanStatus | "sin_iniciar", string> = { ...PLAN_STATUS_LABELS, devuelta: "Devuelta" };

/** Estado de una planificación; `overdue` agrega la marca de atrasada (no entregada y vencida). */
export function PlanStatusBadge({
  status,
  overdue = false,
  long = false,
}: {
  status: PlanStatus | "sin_iniciar";
  overdue?: boolean;
  long?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STYLES[status]}`}>
        {long ? PLAN_STATUS_LABELS[status] : SHORT[status]}
      </span>
      {overdue && (
        <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
          Atrasada
        </span>
      )}
    </span>
  );
}
