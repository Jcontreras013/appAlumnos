"use client";

import { LEAVE_TYPE_LABELS, LEAVE_TYPES, todayInHonduras } from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { type FormState, initialFormState } from "@/lib/form-state";
import { addSubstitutionAction, coverAllAction, createLeaveAction } from "./actions";

type Option = { value: string; label: string };

export function LeaveForm({ teachers }: { teachers: Option[] }) {
  const [state, action] = useActionState(createLeaveAction, initialFormState);
  const today = todayInHonduras();
  const withDefaults: FormState = { ...state, values: { startsOn: today, endsOn: today, ...state.values } };
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField
        name="teacherUserId"
        label="Maestro"
        placeholder="Elige…"
        options={teachers}
        state={state}
      />
      <SelectField
        name="type"
        label="Tipo"
        defaultValue="enfermedad"
        options={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))}
        state={state}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field name="startsOn" label="Desde" type="date" required state={withDefaults} />
        <Field name="endsOn" label="Hasta (último día)" type="date" required state={withDefaults} />
      </div>
      <TextAreaField name="notes" label="Notas (opcional)" rows={2} state={state} />
      <SubmitButton pendingText="Registrando…">Registrar licencia</SubmitButton>
    </form>
  );
}

export function SubstituteForm({
  leaveId,
  assignmentId,
  teachers,
}: {
  leaveId: string;
  assignmentId: string;
  teachers: Option[];
}) {
  const [state, action] = useActionState(addSubstitutionAction.bind(null, leaveId), initialFormState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="min-w-48 flex-1">
        <SelectField
          name="substituteUserId"
          label="Sustituto"
          placeholder="Elige quién cubre…"
          options={teachers}
          state={state}
        />
      </div>
      <SubmitButton pendingText="Asignando…">Asignar</SubmitButton>
      {(state.error || state.message) && (
        <div className="basis-full">
          <FormAlert state={state} />
        </div>
      )}
    </form>
  );
}

export function CoverAllForm({
  leaveId,
  teachers,
  pending,
}: {
  leaveId: string;
  teachers: Option[];
  pending: number;
}) {
  const [state, action] = useActionState(coverAllAction.bind(null, leaveId), initialFormState);
  return (
    <form action={action} className="rounded-lg bg-slate-50 p-3" noValidate>
      <p className="mb-2 text-sm font-medium text-slate-700">
        Cubrir sus {pending} clases con el mismo sustituto (maestro de grado)
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <SelectField
            name="substituteUserId"
            label="Sustituto"
            placeholder="Elige quién cubre…"
            options={teachers}
            state={state}
          />
        </div>
        <SubmitButton pendingText="Asignando…">Cubrir todas</SubmitButton>
      </div>
      {(state.error || state.message) && (
        <div className="mt-2">
          <FormAlert state={state} />
        </div>
      )}
    </form>
  );
}
