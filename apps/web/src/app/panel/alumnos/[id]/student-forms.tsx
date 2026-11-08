"use client";

import {
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
  SEX_LABELS,
  SEXES,
  type StudentDetailDto,
  todayInHonduras,
} from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { type FormState, initialFormState } from "@/lib/form-state";
import {
  addGuardianAction,
  enrollAction,
  transferAction,
  updateStudentAction,
  withdrawAction,
} from "../actions";

type Option = { value: string; label: string };

export function EnrollForm({ studentId, sections }: { studentId: string; sections: Option[] }) {
  const [state, action] = useActionState(enrollAction.bind(null, studentId), initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField name="sectionId" label="Sección" placeholder="Elige…" options={sections} state={state} />
      <SubmitButton pendingText="Matriculando…">Matricular</SubmitButton>
    </form>
  );
}

export function TransferForm({
  target,
  sections,
}: {
  target: { studentId: string; enrollmentId: string };
  sections: Option[];
}) {
  const [state, action] = useActionState(transferAction.bind(null, target), initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField
        name="sectionId"
        label="Nueva sección"
        placeholder="Elige…"
        options={sections}
        state={state}
      />
      <SubmitButton pendingText="Cambiando…">Cambiar de sección</SubmitButton>
    </form>
  );
}

export function WithdrawForm({ target }: { target: { studentId: string; enrollmentId: string } }) {
  const [state, action] = useActionState(withdrawAction.bind(null, target), initialFormState);
  const withDefault: FormState = { ...state, values: { withdrawnOn: todayInHonduras(), ...state.values } };
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field name="withdrawnOn" label="Fecha de retiro" type="date" required state={withDefault} />
      <TextAreaField name="reason" label="Motivo" rows={2} required state={state} />
      <button type="submit" className="btn border border-red-200 bg-white text-red-700 hover:bg-red-50">
        Registrar retiro
      </button>
    </form>
  );
}

export function AddGuardianForm({ studentId }: { studentId: string }) {
  const [state, action] = useActionState(addGuardianAction.bind(null, studentId), initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="fullName" label="Nombre completo" required state={state} />
        <SelectField
          name="relationship"
          label="Parentesco"
          defaultValue="padre"
          options={RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }))}
          state={state}
        />
        <Field name="nationalId" label="Identidad" inputMode="numeric" state={state} />
        <Field name="phone" label="Teléfono" type="tel" state={state} />
        <Field name="email" label="Correo" type="email" state={state} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="isPrimary" className="size-4 accent-brand-600" />
        Hacerlo responsable principal
      </label>
      <SubmitButton pendingText="Agregando…">Agregar responsable</SubmitButton>
    </form>
  );
}

export function StudentDataForm({ student }: { student: StudentDetailDto }) {
  const [state, action] = useActionState(updateStudentAction.bind(null, student.id), initialFormState);
  const current: FormState = {
    ...state,
    values: state.values ?? {
      firstNames: student.firstNames,
      lastNames: student.lastNames,
      nationalId: student.nationalId ?? "",
      birthDate: student.birthDate ?? "",
      sex: student.sex ?? "",
      medicalNotes: student.medicalNotes ?? "",
      notes: student.notes ?? "",
    },
  };
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="firstNames" label="Nombres" required state={current} />
        <Field name="lastNames" label="Apellidos" required state={current} />
        <Field name="nationalId" label="Identidad" inputMode="numeric" state={current} />
        <Field name="birthDate" label="Fecha de nacimiento" type="date" state={current} />
        <SelectField
          name="sex"
          label="Sexo"
          placeholder="Sin especificar"
          options={SEXES.map((s) => ({ value: s, label: SEX_LABELS[s] }))}
          state={current}
        />
      </div>
      <TextAreaField name="medicalNotes" label="Alergias o condiciones de salud" rows={2} state={current} />
      <TextAreaField name="notes" label="Observaciones" rows={2} state={current} />
      <SubmitButton pendingText="Guardando…">Guardar cambios</SubmitButton>
    </form>
  );
}
