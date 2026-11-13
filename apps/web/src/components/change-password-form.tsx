"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/panel/actions";
import { Field, FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";

export function ChangePasswordForm({ temporary = false }: { temporary?: boolean }) {
  const [state, action] = useActionState(changePasswordAction, initialFormState);
  return (
    <form action={action} className="max-w-sm space-y-3" noValidate>
      {temporary && <input type="hidden" name="temporary" value="1" />}
      <FormAlert state={state} />
      <Field
        name="currentPassword"
        label={temporary ? "Contraseña temporal (la que te entregó el centro)" : "Contraseña actual"}
        type="password"
        autoComplete="current-password"
        required
        state={state}
      />
      <Field
        name="newPassword"
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        hint="Al menos 10 caracteres. Una frase corta (mango-río-4821-tarde) es fácil de recordar y difícil de adivinar; no se aceptan las más usadas ni solo números."
        required
        state={state}
      />
      <Field
        name="confirmPassword"
        label="Repite la contraseña nueva"
        type="password"
        autoComplete="new-password"
        required
        state={state}
      />
      <SubmitButton pendingText="Guardando…">Cambiar contraseña</SubmitButton>
    </form>
  );
}
