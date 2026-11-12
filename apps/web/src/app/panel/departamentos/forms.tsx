"use client";

import { useActionState } from "react";
import { resetMfaAction } from "@/app/panel/actions";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { createDepartmentAction, createDistrictAction, createRegionalUserAction } from "./actions";

type Option = { value: string; label: string };

export function DepartmentForm() {
  const [state, action] = useActionState(createDepartmentAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="grid grid-cols-[5rem_1fr] gap-3">
        <Field name="code" label="Código" placeholder="11" inputMode="numeric" required state={state} />
        <Field name="name" label="Departamento" placeholder="Islas de la Bahía" required state={state} />
      </div>
      <SubmitButton pendingText="Creando…">Crear departamento</SubmitButton>
    </form>
  );
}

export function DistrictForm({ departments }: { departments: Option[] }) {
  const [state, action] = useActionState(createDistrictAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField name="departmentId" label="Departamento" options={departments} state={state} />
      <Field name="name" label="Distrito" placeholder="Roatán" required state={state} />
      <SubmitButton pendingText="Creando…">Crear distrito</SubmitButton>
    </form>
  );
}

export function RegionalUserForm({ scopes }: { scopes: Option[] }) {
  const [state, action] = useActionState(createRegionalUserAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField
        name="scopeId"
        label="Dirección de"
        placeholder="Elige el departamento o distrito…"
        options={scopes}
        state={state}
      />
      <Field name="name" label="Nombre completo" required state={state} />
      <Field name="email" label="Correo" type="email" required state={state} />
      <Field
        name="password"
        label="Contraseña temporal"
        type="password"
        autoComplete="new-password"
        required
        state={state}
      />
      <SubmitButton pendingText="Creando…">Dar acceso</SubmitButton>
    </form>
  );
}

/** Para quien perdió el teléfono y sus códigos de recuperación. */
export function ResetMfaForm() {
  const [state, action] = useActionState(resetMfaAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field
        name="login"
        label="Correo o identidad de la persona"
        idPrefix="restablecer-2fa"
        required
        state={state}
        hint="Vuelve a entrar solo con su contraseña y activa la verificación de nuevo."
      />
      <SubmitButton pendingText="Restableciendo…">Restablecer verificación</SubmitButton>
    </form>
  );
}
