import { type ClassTaskDto, TASK_STATUS_LABELS, type TaskStatus } from "@escolar/shared";

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

const publishWhen = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  }).format(new Date(iso));

/** Para el maestro: si la tarea todavía no la ven los alumnos (borrador o programada). */
export function PublishBadge({ task }: { task: Pick<ClassTaskDto, "visibility" | "publishAt"> }) {
  if (task.visibility === "publicada") return null;
  return task.visibility === "borrador" ? (
    <span className="whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
      Borrador · los alumnos no la ven
    </span>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800">
      Se publica {task.publishAt ? publishWhen(task.publishAt) : ""}
    </span>
  );
}
