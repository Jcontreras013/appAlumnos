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
import { type DraftState, draftPlanAction, reviewPlanAction, savePlanAction } from "../actions";

export interface AssistantInfo {
  enabled: boolean;
  remainingToday: number;
  dailyLimit: number;
}

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

export function PlanEditor({
  plan,
  sources,
  assistant,
}: {
  plan: LessonPlanDto;
  sources: LessonPlanDto[];
  /** Asistente de planificación con IA (null si no se pudo consultar). */
  assistant: AssistantInfo | null;
}) {
  const [state, action] = useActionState(savePlanAction, initialFormState);
  const [values, setValues] = useState<PlanContent>(() => normalize(plan.fields, plan.content));
  const [draftState, draftAction, drafting] = useActionState(
    draftPlanAction.bind(null, plan.id),
    {} as DraftState,
  );
  // El borrador del asistente llena el formulario; no se guarda hasta que el docente guarde.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando llega un borrador nuevo
  useEffect(() => {
    if (draftState.content) setValues(normalize(plan.fields, draftState.content));
  }, [draftState.stamp]);
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
  const hasText = Object.values(values).some((v) =>
    typeof v === "string" ? v.trim() : Object.values(v).some((d) => d.trim()),
  );
  function copyFrom(id: string) {
    const source = others.find((s) => s.id === id);
    if (!source) return;
    if (hasText && !window.confirm("Se reemplazará lo que ya escribiste. ¿Continuar?")) return;
    setValues(normalize(plan.fields, source.content));
  }
  // Abierto si la planificación empieza vacía; después queda como el docente lo deje (al llegar el
  // borrador el formulario se llena, y el recuadro no debe cerrarse y esconder el aviso).
  const [assistantOpen, setAssistantOpen] = useState(() => !hasText);
  const topicField = plan.fields.find((f) => f.key === "tema") ?? plan.fields.find((f) => f.type === "texto");
  const currentTopic = topicField ? (values[topicField.key] as string) : "";
  const remaining = draftState.remainingToday ?? assistant?.remainingToday ?? 0;

  return (
    <>
      {assistant && (
        <section className="card border-brand-100 bg-brand-50/40">
          <details open={assistantOpen} onToggle={(e) => setAssistantOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-slate-900">
              Preparar un borrador con el asistente
            </summary>
            <div className="space-y-3 border-t border-brand-100 px-4 py-4">
              <p className="text-sm text-slate-600">
                {plan.assignment.subjectLanguage === "en" ? (
                  <>
                    {plan.assignment.subjectName} se imparte en inglés: el asistente escribe el borrador{" "}
                    <strong>en inglés</strong>. Si el colegio sigue unos estándares (por ejemplo, Common
                    Core), menciónalos en las indicaciones.
                  </>
                ) : (
                  "Escribe el tema y el asistente llena la plantilla con un borrador según el Currículo Nacional Básico."
                )}{" "}
                Revísalo y ajústalo antes de guardar: lo que se entrega lo decides tú. Al asistente solo van
                la asignatura, el grado, el tema y tus indicaciones, nunca datos de tus alumnos.
              </p>
              {!assistant.enabled ? (
                <p className="text-sm font-medium text-slate-700">
                  El asistente no está activado en esta instalación.
                </p>
              ) : (
                <form
                  action={draftAction}
                  noValidate
                  className="space-y-3"
                  onSubmit={(e) => {
                    if (
                      hasText &&
                      !window.confirm("El borrador reemplazará lo que ya escribiste. ¿Continuar?")
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <FormAlert state={draftState} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label htmlFor="asistente-tema" className="label">
                        Tema de la semana
                      </label>
                      <input
                        id="asistente-tema"
                        name="topic"
                        defaultValue={draftState.values?.topic ?? currentTopic}
                        placeholder="Por ejemplo: El ciclo del agua"
                        className="input"
                        aria-invalid={Boolean(draftState.fields?.topic)}
                      />
                      {draftState.fields?.topic && (
                        <p className="mt-1 text-xs text-red-600">{draftState.fields.topic}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="asistente-indicaciones" className="label">
                        Indicaciones <span className="font-normal text-slate-400">(opcional)</span>
                      </label>
                      <textarea
                        id="asistente-indicaciones"
                        name="notes"
                        defaultValue={draftState.values?.notes}
                        rows={2}
                        placeholder="Libro de texto que usan, materiales con que cuentas, alumnos que necesitan apoyo…"
                        className="input min-h-16"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" className="btn-primary" disabled={drafting || remaining === 0}>
                      {drafting ? "Preparando el borrador… (puede tardar un minuto)" : "Preparar borrador"}
                    </button>
                    <span className="text-xs text-slate-500">
                      {remaining === 0
                        ? "Ya usaste los borradores de hoy."
                        : `Te ${remaining === 1 ? "queda 1 borrador" : `quedan ${remaining} borradores`} hoy.`}
                    </span>
                  </div>
                </form>
              )}
            </div>
          </details>
        </section>
      )}
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
    </>
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

/** Revisión de la dirección, la coordinación o la secretaría: aprobar, o devolver explicando qué corregir. */
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
