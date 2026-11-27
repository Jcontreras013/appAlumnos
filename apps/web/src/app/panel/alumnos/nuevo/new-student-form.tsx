"use client";

import {
  ageOn,
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
  SEX_LABELS,
  SEXES,
  todayInHonduras,
} from "@escolar/shared";
import { useActionState, useState } from "react";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { createStudentAction } from "../actions";

type Option = { value: string; label: string };

export function NewStudentForm({
  sections,
  sectionRequired = false,
}: {
  sections: Option[];
  /** El maestro siempre matricula al registrar (y solo en sus secciones). */
  sectionRequired?: boolean;
}) {
  const [state, action] = useActionState(createStudentAction, initialFormState);
  // Responde por sí mismo (mayor de edad, o paga él su colegiatura): el responsable es opcional.
  const [self, setSelf] = useState(state.values?.selfResponsible === "on");
  const [touched, setTouched] = useState(false);
  const [adult, setAdult] = useState(false);

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
          <Field
            name="birthDate"
            label="Fecha de nacimiento"
            type="date"
            state={state}
            onChange={(e) => {
              const value = e.currentTarget.value;
              const isAdult = /^\d{4}-\d{2}-\d{2}$/.test(value) && ageOn(value, todayInHonduras()) >= 18;
              setAdult(isAdult);
              // Un mayor de edad casi siempre responde por sí mismo: se marca, pero se puede desmarcar.
              if (isAdult && !touched) setSelf(true);
            }}
          />
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
          hint="La ve el personal del centro en la ficha del alumno."
          rows={2}
          state={state}
        />
      </fieldset>

      <div className="card space-y-1 p-5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="selfResponsible"
            checked={self}
            onChange={(e) => {
              setTouched(true);
              setSelf(e.currentTarget.checked);
            }}
            className="mt-0.5 rounded border-slate-300"
          />
          <span>
            <span className="font-medium text-slate-900">El alumno responde por sí mismo</span>
            <span className="block text-slate-500">
              Mayor de edad, o paga él su colegiatura (por ejemplo, en jornada de fin de semana). No necesita
              responsable y, con su cuenta del aula virtual, ve sus cobros y paga.
              {adult && !self && " Según su fecha de nacimiento ya tiene 18 años."}
            </span>
          </span>
        </label>
      </div>

      <fieldset className="card space-y-4 p-5" hidden={self} disabled={self}>
        <legend className="sr-only">Responsable principal</legend>
        <h2 className="font-semibold text-slate-900">Responsable principal</h2>
        <p className="-mt-2 text-sm text-slate-500">
          Si el alumno tiene hermanos en el centro, escribe la misma identidad del responsable y quedarán en
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
            {sectionRequired
              ? "No tienes secciones asignadas este año: pide a la dirección que te asigne tus clases."
              : "No hay secciones en el año vigente. Puedes registrar al alumno y matricularlo después."}
          </p>
        ) : (
          <SelectField
            name="sectionId"
            label="Sección"
            placeholder={sectionRequired ? "Elige la sección" : "Matricular después"}
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
