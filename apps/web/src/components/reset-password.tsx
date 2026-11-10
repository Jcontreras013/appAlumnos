"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type ResetPasswordState, resetPasswordAction } from "@/app/panel/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="text-xs font-semibold text-brand-700 hover:underline" disabled={pending}>
      {pending ? "Generando…" : "Nueva contraseña temporal"}
    </button>
  );
}

/** Para quien olvidó su contraseña o quedó bloqueado: genera una temporal (se muestra una sola vez). */
export function ResetPassword({ userId, name }: { userId: string; name: string }) {
  const [state, action] = useActionState<ResetPasswordState, FormData>(resetPasswordAction, {});
  if (state.reset) {
    return (
      <p role="status" className="max-w-xs text-left text-xs text-brand-900">
        {name} entra con <strong>{state.reset.login}</strong> y{" "}
        <strong className="font-mono">{state.reset.temporaryPassword}</strong> (la cambiará al entrar).
        Anótala: no se vuelve a mostrar.
      </p>
    );
  }
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`¿Dar una contraseña temporal a ${name}? La actual dejará de servir.`))
          e.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Submit />
      {state.error && <p className="mt-1 max-w-xs text-left text-xs text-red-700">{state.error}</p>}
    </form>
  );
}
