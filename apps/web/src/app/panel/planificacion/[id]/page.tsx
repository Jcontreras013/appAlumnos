import {
  type DaysValue,
  formatDay,
  formatWeekRange,
  type PlanHistoryDto,
  todayInHonduras,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanStatusBadge } from "@/components/plan-status";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { PlanEditor, ReviewForm } from "./plan-forms";

export const metadata: Metadata = { title: "Planificación" };

const ACTIONS: Record<PlanHistoryDto["action"], string> = {
  creada: "La creó",
  guardada: "Guardó cambios",
  enviada: "La envió a revisión",
  devuelta: "La devolvió con observaciones",
  aprobada: "La aprobó",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-HN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  });

export default async function PlanPage({ params }: PageProps<"/panel/planificacion/[id]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { plan, history, canEdit, canReview } = await academic
    .getPlan(session.accessToken, id)
    .catch((err) => {
      if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    });
  const sources = canEdit ? await academic.recentPlans(session.accessToken).catch(() => []) : [];
  const overdue = !plan.submittedAt && todayInHonduras() > plan.deadline;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/panel/planificacion?semana=${plan.weekStart}`}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Planificación de la semana
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">
            {plan.assignment.subjectName} · {plan.assignment.sectionLabel}
          </h1>
          <PlanStatusBadge status={plan.status} overdue={overdue} long />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {plan.assignment.teacherName} · Semana del {formatWeekRange(plan.weekStart)} · Entrega:{" "}
          {formatDay(plan.deadline)}
        </p>
      </div>

      {plan.reviewComment && (plan.status === "devuelta" || plan.status === "aprobada") && (
        <section
          role={plan.status === "devuelta" ? "alert" : undefined}
          className={`rounded-xl border p-4 text-sm ${
            plan.status === "devuelta"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-brand-100 bg-brand-50 text-brand-900"
          }`}
        >
          <p className="font-semibold">
            {plan.status === "devuelta" ? "Observaciones para corregir" : "Comentario de la revisión"} ·{" "}
            {plan.reviewerName}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{plan.reviewComment}</p>
        </section>
      )}

      {canEdit ? (
        <PlanEditor plan={plan} sources={sources} />
      ) : (
        <section className="space-y-4">
          {plan.status === "enviada" && !canReview && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              En revisión: la dirección o coordinación la revisará. Si la devuelven, podrás corregirla aquí.
            </p>
          )}
          {plan.fields.map((field) => {
            const value = plan.content[field.key];
            return (
              <div key={field.key} className="card p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {field.label}
                </h2>
                {field.type === "dias" ? (
                  <div className="mt-2 grid gap-3 md:grid-cols-5">
                    {WEEKDAYS.map((day) => (
                      <div key={day}>
                        <p className="text-xs font-semibold text-slate-700">{WEEKDAY_LABELS[day]}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                          {(value as DaysValue | undefined)?.[day] || (
                            <span className="text-slate-400">—</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                    {(value as string | undefined) || <span className="text-slate-400">Sin llenar</span>}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {canReview && <ReviewForm planId={plan.id} />}

      <section className="card p-4">
        <h2 className="text-sm font-semibold text-slate-700">Historial</h2>
        <ol className="mt-3 space-y-2 border-l border-slate-200 pl-4">
          {history.map((h) => (
            <li key={h.id} className="text-sm">
              <span className="font-medium text-slate-900">{h.actorName}</span>{" "}
              <span className="text-slate-600">{ACTIONS[h.action].toLowerCase()}</span>{" "}
              <span className="text-xs text-slate-400">· {when(h.createdAt)}</span>
              {h.comment && <p className="mt-0.5 whitespace-pre-wrap text-slate-600">«{h.comment}»</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
