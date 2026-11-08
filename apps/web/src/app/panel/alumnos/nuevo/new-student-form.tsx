"use client";

import { RELATIONSHIP_LABELS, RELATIONSHIPS, SEX_LABELS, SEXES } from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { createStudentAction } from "../actions";

type Option = { value: string; label: string };

export function NewStudentForm({ sections }: { sections: Option[] }) {
  const [state, action] = useActionState(createStudentAction, initialFormState);

  return (
    <form action={action} className="space-y-6" noValidate>
      <FormAlert state={state} />

      <fieldset className="card space-y-4 p-5">
        <legend className="sr-only">Alumno</legend>
        <h2 className="font-semibold text-slate-900">Alumno</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="firstNames" label="Nombres" autoComplete="off" required state={state} />
          <Field name="lastNames" label="Apellidos" autoComplete="off" required state={state} />
          <Field
            name="nationalId"
            label="Identidad (opcional)"
            placeholder="0801-2019-00001"
            inputMode="numeric"
            state={state}
          />
          <Field name="birthDate" label="Fecha de nacimiento" type="date" state={state} />
          <SelectField
            name="sex"
            label="Sexo"
            placeholder="Sin especificar"
            options={SEXES.map((s) => ({ value: s, label: SEX_LABELS[s] }))}
            state={state}
          />
        </div>
        <TextAreaField
          name="medicalNotes"
          label="Alergias o condiciones de salud"
          hint="La verá enfermería y, más adelante, la cafetería."
          rows={2}
          state={state}
        />
      </fieldset>

      <fieldset className="card space-y-4 p-5">
        <legend className="sr-only">Responsable principal</legend>
        <h2 className="font-semibold text-slate-900">Responsable principal</h2>
        <p className="-mt-2 text-sm text-slate-500">
          Si el alumno tiene hermanos en el colegio, escribe la misma identidad del responsable y quedarán en
          la misma familia.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="guardian.fullName" label="Nombre completo" autoComplete="off" required state={state} />
          <SelectField
            name="guardian.relationship"
            label="Parentesco"
            defaultValue="madre"
            options={RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }))}
            state={state}
          />
          <Field
            name="guardian.nationalId"
            label="Identidad"
            placeholder="0801-1985-01234"
            inputMode="numeric"
            state={state}
          />
          <Field
            name="guardian.phone"
            label="Teléfono"
            type="tel"
            placeholder="9999-9999"
            hint="Teléfono o correo: al menos uno."
            state={state}
          />
          <Field name="guardian.email" label="Correo" type="email" state={state} />
        </div>
      </fieldset>

      <fieldset className="card space-y-4 p-5">
        <legend className="sr-only">Matrícula</legend>
        <h2 className="font-semibold text-slate-900">Matrícula del año vigente</h2>
        {sections.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hay secciones en el año vigente. Puedes registrar al alumno y matricularlo después.
          </p>
        ) : (
          <SelectField
            name="sectionId"
            label="Sección"
            placeholder="Matricular después"
            options={sections}
            state={state}
          />
        )}
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton pendingText="Guardando…">Registrar alumno</SubmitButton>
      </div>
    </form>
  );
}
