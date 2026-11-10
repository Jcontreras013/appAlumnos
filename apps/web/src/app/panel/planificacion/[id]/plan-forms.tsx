"use client";

import {
  type DaysValue,
  formatWeekRange,
  type LessonPlanDto,
  type PlanContent,
  type PlanField,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "@escolar/shared";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { FormAlert } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { reviewPlanAction, savePlanAction } from "../actions";

const emptyDays = (): DaysValue => Object.fromEntries(WEEKDAYS.map((d) => [d, ""])) as DaysValue;

function normalize(fields: PlanField[], content: PlanContent): PlanContent {
  return Object.fromEntries(
    fields.map((f) => {
      const value = content[f.key];
      if (f.type === "dias") return [f.key, { ...emptyDays(), ...(typeof value === "object" ? value : {}) }];
      return [f.key, typeof value === "string" ? value : ""];
    }),
  );
}

export function PlanEditor({ plan, sources }: { plan: LessonPlanDto; sources: LessonPlanDto[] }) {
  const [state, action] = useActionState(savePlanAction, initialFormState);
  const [values, setValues] = useState<PlanContent>(() => normalize(plan.fields, plan.content));
  const [saved, setSaved] = useState(() => JSON.stringify(normalize(plan.fields, plan.content)));
  const dirty = JSON.stringify(values) !== saved;

  // Lo guardado en el servidor pasa a ser el punto de comparación (y se avisa al salir sin guardar).
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando llega el resultado de guardar
  useEffect(() => {
    if (state.ok) setSaved(JSON.stringify(values));
  }, [state]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const others = sources.filter((s) => s.id !== plan.id);
  function copyFrom(id: string) {
    const source = others.find((s) => s.id === id);
    if (!source) return;
    const hasText = Object.values(values).some((v) =>
      typeof v === "string" ? v.trim() : Object.values(v).some((d) => d.trim()),
    );
    if (hasText && !window.confirm("Se reemplazará lo que ya escribiste. ¿Continuar?")) return;
    setValues(normalize(plan.fields, source.content));
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="id" value={plan.id} />
      <input type="hidden" name="version" value={plan.version} />
      <FormAlert state={state} />

      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm">
          <label htmlFor="copiar" className="text-slate-600">
            Empezar desde otra planificación tuya:
          </label>
          <select
            id="copiar"
            className="input w-auto max-w-full py-1.5"
            defaultValue=""
            onChange={(e) => {
              copyFrom(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Elegir…</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.assignment.subjectName} {s.assignment.sectionLabel} · {formatWeekRange(s.weekStart)}
              </option>
            ))}
          </select>
        </div>
      )}

      {plan.fields.map((field) => {
        const error = state.fields?.[field.key];
        const label = (
          <span className="label">
            {field.label}
            {field.required ? (
              <span className="text-red-600"> *</span>
            ) : (
              <span className="font-normal text-slate-400"> (opcional)</span>
            )}
          </span>
        );
        if (field.type === "dias") {
          const days = values[field.key] as DaysValue;
          return (
            <fieldset key={field.key} className="card space-y-3 p-4" aria-invalid={Boolean(error)}>
              <legend className="sr-only">{field.label}</legend>
              {label}
              {field.help && <p className="-mt-2 text-xs text-slate-500">{field.help}</p>}
              <div className="grid gap-3 md:grid-cols-5">
                {WEEKDAYS.map((day) => (
                  <label key={day} className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {WEEKDAY_LABELS[day]}
                    </span>
                    <textarea
                      name={`f.${field.key}.${day}`}
                      value={days[day]}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [field.key]: { ...(v[field.key] as DaysValue), [day]: e.target.value },
                        }))
                      }
                      rows={5}
                      className="input min-h-28 text-sm"
                    />
                  </label>
                ))}
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </fieldset>
          );
        }
        const common = {
          id: `campo-${field.key}`,
          name: `f.${field.key}`,
          value: values[field.key] as string,
          "aria-invalid": Boolean(error),
          className: "input",
        };
        return (
          <div key={field.key}>
            <label htmlFor={common.id}>{label}</label>
            {field.help && <p className="-mt-0.5 mb-1 text-xs text-slate-500">{field.help}</p>}
            {field.type === "texto" ? (
              <input
                {...common}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            ) : (
              <textarea
                {...common}
                rows={4}
                className="input min-h-24"
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            )}
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        );
      })}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <ActionButton intent="guardar" className="btn-secondary" pendingText="Guardando…">
          Guardar borrador
        </ActionButton>
        <ActionButton intent="enviar" className="btn-primary" pendingText="Enviando…">
          Enviar a revisión
        </ActionButton>
        <span className="text-xs text-slate-500">
          {dirty ? "Tienes cambios sin guardar" : "Sin cambios pendientes"} · Vence el{" "}
          {new Date(`${plan.deadline}T12:00:00Z`).toLocaleDateString("es-HN", {
            day: "numeric",
            month: "long",
          })}
        </span>
      </div>
    </form>
  );
}

function ActionButton({
  intent,
  className,
  pendingText,
  children,
}: {
  intent: string;
  className: string;
  pendingText: string;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} className={className} disabled={pending}>
      {mine ? pendingText : children}
    </button>
  );
}

/** Revisión de la dirección o coordinación: aprobar, o devolver explicando qué corregir. */
export function ReviewForm({ planId }: { planId: string }) {
  const [state, action] = useActionState(reviewPlanAction, initialFormState);
  return (
    <form action={action} className="card space-y-3 border-sky-200 bg-sky-50/50 p-4" noValidate>
      <input type="hidden" name="id" value={planId} />
      <h2 className="font-semibold text-slate-900">Revisión</h2>
      <FormAlert state={state} />
      <label htmlFor="comentario" className="label">
        Observaciones <span className="font-normal text-slate-500">(obligatorias para devolver)</span>
      </label>
      <textarea
        id="comentario"
        name="comment"
        rows={3}
        className="input"
        defaultValue={state.values?.comment}
        aria-invalid={Boolean(state.fields?.comment)}
        placeholder="Ej.: Falta la evaluación del miércoles."
      />
      {state.fields?.comment && <p className="text-xs text-red-600">{state.fields.comment}</p>}
      <div className="flex flex-wrap gap-2">
        <ActionButtonReview decision="aprobar" className="btn-primary">
          Aprobar
        </ActionButtonReview>
        <ActionButtonReview decision="devolver" className="btn-secondary">
          Devolver con observaciones
        </ActionButtonReview>
      </div>
    </form>
  );
}

function ActionButtonReview({
  decision,
  className,
  children,
}: {
  decision: string;
  className: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="decision" value={decision} className={className} disabled={pending}>
      {children}
    </button>
  );
}
