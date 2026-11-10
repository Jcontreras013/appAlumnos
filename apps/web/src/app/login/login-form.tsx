"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { loginAction } from "./actions";

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action] = useActionState(loginAction, initialFormState);
  const shown = !state.error && expired ? { error: "Tu sesión expiró. Vuelve a iniciar sesión." } : state;

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormAlert state={shown} />
      <Field
        name="email"
        label="Correo o número de identidad"
        type="text"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="nombre@correo.hn o 0801-1985-01234"
        autoComplete="username"
        required
        autoFocus
        state={state}
      />
      <Field
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        required
        state={state}
      />
      <div className="pt-2 [&>button]:w-full">
        <SubmitButton pendingText="Entrando…">Iniciar sesión</SubmitButton>
      </div>
      <p className="text-center text-sm">
        <Link href="/login/olvide" className="font-medium text-brand-700 hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
    </form>
  );
}
