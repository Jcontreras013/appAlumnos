"use client";

import { todayInHonduras } from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { receiveTransferAction, sendTransferAction } from "./actions";

type Option = { value: string; label: string };

export function SendTransferForm({ studentId, schools }: { studentId: string; schools: Option[] }) {
  const [state, action] = useActionState(sendTransferAction, initialFormState);
  if (state.ok) return <FormAlert state={state} />;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="studentId" value={studentId} />
      <FormAlert state={state} />
      <SelectField
        name="toSchoolId"
        label="Centro al que se traslada"
        options={schools}
        placeholder={schools.length ? "Elige…" : "No hay otros centros en tu departamento"}
        state={state}
      />
      <Field
        name="date"
        label="Fecha del traslado"
        type="date"
        max={todayInHonduras()}
        defaultValue={state.values?.date ?? todayInHonduras()}
        state={state}
      />
      <TextAreaField name="notes" label="Observaciones (opcional)" rows={2} state={state} />
      <p className="text-xs text-slate-500">
        Se retira su matrícula aquí y el otro centro recibe una copia de sus datos, responsables y notas del
        año.
      </p>
      <SubmitButton pendingText="Registrando…">Registrar traslado</SubmitButton>
    </form>
  );
}

export function ReceiveTransferForm({ id, sections }: { id: string; sections: Option[] }) {
  const [state, action] = useActionState(receiveTransferAction, initialFormState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <div className="min-w-48">
        <SelectField
          idPrefix={`recibir-${id}`}
          name="sectionId"
          label="Matricular en"
          options={sections}
          placeholder="Elige la sección…"
          state={state}
        />
      </div>
      <SubmitButton pendingText="Recibiendo…">Recibir</SubmitButton>
      <div className="w-full">
        <FormAlert state={state} />
      </div>
    </form>
  );
}
