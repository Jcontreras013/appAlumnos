"use client";

import {
  DISCIPLINE_LABELS,
  DISCIPLINE_SEVERITIES,
  type DisciplineKind,
  SEVERITY_LABELS,
  todayInHonduras,
} from "@escolar/shared";
import { Field, SelectField, TextAreaField } from "@/components/form-controls";
import type { FormState } from "@/lib/form-state";

/** Los campos de un llamado de atención o una medida; se usan en la página y en la ficha del alumno. */
export function DisciplineFields({
  state,
  kinds,
  idPrefix = "disciplina",
}: {
  state: FormState;
  kinds: readonly DisciplineKind[];
  idPrefix?: string;
}) {
  const notify = state.values ? state.values.notifyFamily === "on" : true;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          idPrefix={idPrefix}
          name="kind"
          label="Medida"
          options={kinds.map((k) => ({ value: k, label: DISCIPLINE_LABELS[k] }))}
          placeholder="Elige…"
          state={state}
        />
        <SelectField
          idPrefix={idPrefix}
          name="severity"
          label="Falta"
          options={DISCIPLINE_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] }))}
          placeholder="Elige…"
          state={state}
        />
      </div>
      <Field
        idPrefix={idPrefix}
        name="date"
        label="Fecha de la falta"
        type="date"
        max={todayInHonduras()}
        defaultValue={state.values?.date ?? todayInHonduras()}
        state={state}
      />
      <TextAreaField
        idPrefix={idPrefix}
        name="description"
        label="¿Qué pasó?"
        rows={3}
        placeholder="Por ejemplo: usó el celular durante el examen de Matemáticas."
        defaultValue={state.values?.description}
        state={state}
      />
      <TextAreaField
        idPrefix={idPrefix}
        name="measure"
        label="Medida o acuerdo (opcional)"
        rows={2}
        placeholder="Por ejemplo: se citó a la madre para el lunes a las 7:00."
        defaultValue={state.values?.measure}
        state={state}
      />
      {kinds.includes("suspension") && (
        <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold text-slate-600">Solo si es suspensión</legend>
          <Field idPrefix={idPrefix} name="suspensionFrom" label="Desde" type="date" state={state} />
          <Field idPrefix={idPrefix} name="suspensionTo" label="Hasta" type="date" state={state} />
        </fieldset>
      )}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="notifyFamily" defaultChecked={notify} className="mt-0.5" />
        <span>
          Avisar a la familia
          <span className="block text-xs text-slate-500">La familia lo verá en su portal.</span>
        </span>
      </label>
    </>
  );
}
