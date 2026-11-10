"use client";

import { ROLE_LABELS, SCHOOL_ROLES } from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { createUserAction } from "./actions";

export function CreateUserForm() {
  const [state, action] = useActionState(createUserAction, initialFormState);
  const roleError = state.fields?.role;

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormAlert state={state} />
      <Field name="name" label="Nombre completo" autoComplete="off" required state={state} />
      <Field
        name="nationalId"
        label="Número de identidad"
        placeholder="0801-1990-01234"
        autoComplete="off"
        hint="Con su identidad (o su correo) entra a la plataforma."
        state={state}
      />
      <Field name="email" label="Correo (opcional)" type="email" autoComplete="off" state={state} />
      <div>
        <label htmlFor="campo-role" className="label">
          Rol
        </label>
        {/*
          React 19 reinicia el formulario después de cada envío. Un <input> vuelve a su defaultValue
          actualizado, pero un <select> no: volvería en silencio a la primera opción y el usuario se
          crearía con otro rol. La `key` lo vuelve a montar con el rol que se había elegido.
        */}
        <select
          key={state.values?.role ?? "inicial"}
          id="campo-role"
          name="role"
          className="input"
          defaultValue={state.values?.role ?? "docente"}
          aria-invalid={Boolean(roleError)}
        >
          {SCHOOL_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        {roleError && <p className="mt-1 text-xs text-red-600">{roleError}</p>}
      </div>
      <Field
        name="password"
        label="Contraseña (opcional)"
        type="password"
        autoComplete="new-password"
        hint="Déjala vacía y se genera una temporal que la persona cambia al entrar."
        state={state}
      />
      <SubmitButton pendingText="Creando…">Crear usuario</SubmitButton>
    </form>
  );
}
