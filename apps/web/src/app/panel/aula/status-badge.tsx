import { TASK_STATUS_LABELS, type TaskStatus } from "@escolar/shared";

const STATUS_STYLES: Record<TaskStatus, string> = {
  pendiente: "bg-slate-100 text-slate-700",
  borrador: "bg-amber-50 text-amber-900",
  entregada: "bg-brand-50 text-brand-700",
  tarde: "bg-amber-100 text-amber-900",
  calificada: "bg-sky-50 text-sky-800",
  vencida: "bg-red-50 text-red-800",
};

/** Cómo va la entrega de una tarea (o el examen) de un alumno. */
export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}
