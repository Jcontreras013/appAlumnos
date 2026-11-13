"use client";

import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { createSchoolAction } from "./actions";

export function CreateSchoolForm({ districts }: { districts: Array<{ value: string; label: string }> }) {
  const [state, action] = useActionState(createSchoolAction, initialFormState);

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormAlert state={state} />
      <Field name="name" label="Nombre del colegio" required state={state} />
      <Field
        name="slug"
        label="Identificador"
        placeholder="colegio-san-jose"
        hint="Minúsculas, números y guiones. No se puede cambiar después."
        required
        state={state}
      />
      <Field
        name="rtn"
        label="RTN (opcional)"
        placeholder="0801-1990-123456"
        inputMode="numeric"
        state={state}
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          name="sector"
          label="Sector"
          defaultValue="publico"
          options={[
            { value: "publico", label: "Público" },
            { value: "privado", label: "Privado" },
          ]}
          state={state}
        />
        <Field name="code" label="Código del centro" placeholder="Código SACE" state={state} />
      </div>
      <SelectField
        name="districtId"
        label="Distrito"
        placeholder={
          districts.length ? "Sin distrito (privado independiente)" : "Crea distritos en Departamentos"
        }
        options={districts}
        state={state}
      />

      <fieldset className="space-y-4 border-t border-slate-200 pt-4">
        <legend className="pt-0 text-sm font-semibold text-slate-900">Administrador del colegio</legend>
        <Field name="admin.name" label="Nombre completo" autoComplete="off" required state={state} />
        <Field
          name="admin.email"
          label="Correo electrónico"
          type="email"
          autoComplete="off"
          required
          state={state}
        />
        <Field
          name="admin.password"
          label="Contraseña temporal"
          type="password"
          autoComplete="new-password"
          hint="Mínimo 10 caracteres; no se aceptan las más usadas ni solo números."
          required
          state={state}
        />
      </fieldset>
      <SubmitButton pendingText="Creando…">Crear colegio</SubmitButton>
    </form>
  );
}
