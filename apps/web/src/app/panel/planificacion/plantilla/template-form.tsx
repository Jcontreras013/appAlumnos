"use client";

import {
  DEFAULT_PLAN_TEMPLATE,
  fieldKeyFromLabel,
  PLAN_FIELD_TYPE_LABELS,
  PLAN_FIELD_TYPES,
  type PlanField,
  type PlanFieldType,
  type PlanTemplateInput,
} from "@escolar/shared";
import { useActionState, useState } from "react";
import { FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { saveTemplateAction } from "../actions";

const DEADLINES = [
  "El mismo lunes",
  "El domingo anterior",
  "El sábado anterior",
  "El viernes anterior",
  "El jueves anterior",
  "El miércoles anterior",
  "El martes anterior",
  "El lunes anterior",
];

export function TemplateForm({ template }: { template: PlanTemplateInput }) {
  const [state, action] = useActionState(saveTemplateAction, initialFormState);
  const [fields, setFields] = useState<PlanField[]>(template.fields);
  const [deadline, setDeadline] = useState(template.deadlineDaysBefore);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<PlanFieldType>("parrafo");

  const update = (i: number, patch: Partial<PlanField>) =>
    setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, delta: number) =>
    setFields((prev) => {
      const next = [...prev];
      const [item] = next.splice(i, 1);
      if (item) next.splice(i + delta, 0, item);
      return next;
    });

  function addField() {
    const label = newLabel.trim();
    if (label.length < 2) return;
    let key = fieldKeyFromLabel(label);
    for (let n = 2; fields.some((f) => f.key === key); n++)
      key = `${fieldKeyFromLabel(label).slice(0, 36)}_${n}`;
    setFields((prev) => [...prev, { key, label, type: newType, required: false }]);
    setNewLabel("");
  }

  const payload: PlanTemplateInput = {
    deadlineDaysBefore: deadline,
    fields: fields.map((f) => ({ ...f, help: f.help?.trim() || undefined })),
  };

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="template" value={JSON.stringify(payload)} />
      <FormAlert state={state} />

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <label htmlFor="vence" className="text-sm font-medium text-slate-700">
          La planificación de cada semana se entrega
        </label>
        <select
          id="vence"
          className="input w-56"
          value={deadline}
          onChange={(e) => setDeadline(Number(e.target.value))}
        >
          {DEADLINES.map((label, days) => (
            <option key={label} value={days}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <ol className="space-y-3">
        {fields.map((field, i) => (
          <li key={field.key} className="card grid gap-3 p-4 md:grid-cols-[1fr_14rem_auto]">
            <div className="space-y-2">
              <input
                aria-label={`Nombre del campo ${i + 1}`}
                className="input font-medium"
                value={field.label}
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <input
                aria-label={`Ayuda del campo ${i + 1}`}
                className="input text-xs"
                placeholder="Ayuda para el maestro (opcional)"
                value={field.help ?? ""}
                onChange={(e) => update(i, { help: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <select
                aria-label={`Tipo del campo ${i + 1}`}
                className="input"
                value={field.type}
                onChange={(e) => update(i, { type: e.target.value as PlanFieldType })}
              >
                {PLAN_FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PLAN_FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Obligatorio
              </label>
            </div>
            <div className="flex items-start gap-1">
              <button
                type="button"
                className="btn-secondary px-2 py-1"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Subir"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1"
                disabled={i === fields.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Bajar"
              >
                ↓
              </button>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-red-700"
                disabled={fields.length === 1}
                onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Quitar ${field.label}`}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="nuevo-campo" className="label">
            Agregar un campo
          </label>
          <input
            id="nuevo-campo"
            className="input"
            placeholder="Ej.: Adecuaciones para alumnos con necesidades especiales"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addField();
              }
            }}
          />
        </div>
        <select
          aria-label="Tipo del campo nuevo"
          className="input w-auto"
          value={newType}
          onChange={(e) => setNewType(e.target.value as PlanFieldType)}
        >
          {PLAN_FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {PLAN_FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary"
          onClick={addField}
          disabled={newLabel.trim().length < 2}
        >
          Agregar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Guardando…">Guardar plantilla</SubmitButton>
        <button
          type="button"
          className="text-sm font-semibold text-slate-600 hover:underline"
          onClick={() => {
            setFields(DEFAULT_PLAN_TEMPLATE.fields);
            setDeadline(DEFAULT_PLAN_TEMPLATE.deadlineDaysBefore);
          }}
        >
          Volver a la plantilla del Currículo Nacional Básico
        </button>
      </div>
    </form>
  );
}
