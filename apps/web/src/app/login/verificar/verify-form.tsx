"use client";

import { useActionState } from "react";
import { FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { verifyMfaAction } from "./actions";

export function VerifyForm() {
  const [state, action] = useActionState(verifyMfaAction, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormAlert state={state} />
      <div>
        <label htmlFor="code" className="label">
          Código de 6 dígitos
        </label>
        <input
          id="code"
          name="code"
          className="input text-center text-lg tracking-[0.3em] tabular-nums"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={9}
          required
          // biome-ignore lint/a11y/noAutofocus: es el único campo de la pantalla
          autoFocus
        />
        <p className="mt-1 text-xs text-slate-500">
          ¿Perdiste el teléfono? Escribe aquí uno de tus códigos de recuperación (como K7QM-4XPT).
        </p>
      </div>
      <SubmitButton pendingText="Verificando…">Entrar</SubmitButton>
    </form>
  );
}
