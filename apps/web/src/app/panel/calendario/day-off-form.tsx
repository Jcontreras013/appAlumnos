"use client";

import { DAY_OFF_KINDS, DAY_OFF_LABELS } from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { addDayOffAction } from "./actions";

export function DayOffForm({ min, max }: { min?: string; max?: string }) {
  const [state, action] = useActionState(addDayOffAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ? state.message : "dia"}>
      <FormAlert state={state} />
      <Field name="name" label="Motivo" required placeholder="Día de la Independencia" state={state} />
      <SelectField
        name="kind"
        label="Tipo"
        options={DAY_OFF_KINDS.map((k) => ({ value: k, label: DAY_OFF_LABELS[k] }))}
        defaultValue="feriado"
        state={state}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field name="startsOn" label="Desde" type="date" required min={min} max={max} state={state} />
        <Field
          name="endsOn"
          label="Hasta"
          type="date"
          min={min}
          max={max}
          hint="Vacío: un solo día."
          state={state}
        />
      </div>
      <SubmitButton pendingText="Guardando…">Agregar al calendario</SubmitButton>
    </form>
  );
}
