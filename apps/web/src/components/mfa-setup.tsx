"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  enableMfaAction,
  type MfaEnableState,
  type MfaSetupState,
  startMfaSetupAction,
} from "@/app/panel/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
      {pending ? "Verificando…" : "Activar"}
    </button>
  );
}

/**
 * Activar la verificación en dos pasos: 1) escanear el QR con la app, 2) escribir el código que
 * muestra, 3) guardar los códigos de recuperación (se ven una sola vez).
 */
export function MfaSetup({ doneHref = "/panel" }: { doneHref?: string }) {
  const [started, setStarted] = useState<MfaSetupState>({});
  const [pending, startTransition] = useTransition();
  const [enabled, enable] = useActionState<MfaEnableState, FormData>(enableMfaAction, {});
  const [saved, setSaved] = useState(false);

  if (enabled.recoveryCodes) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-900"
        >
          Listo: la verificación en dos pasos está activada. Desde ahora, al entrar te pedirá el código de la
          app.
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Tus códigos de recuperación</h3>
          <p className="mt-1 text-sm text-slate-600">
            Si pierdes el teléfono, cada código sirve una vez para entrar. Imprímelos o anótalos y guárdalos
            en un lugar seguro: <strong>no se vuelven a mostrar</strong>.
          </p>
        </div>
        <ul className="grid max-w-md grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
          {enabled.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-4 print:hidden">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            Imprimir
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Ya los guardé
          </label>
          {saved ? (
            <a href={doneHref} className="btn-primary">
              Continuar
            </a>
          ) : (
            <span className="btn-primary pointer-events-none opacity-50" aria-disabled="true">
              Continuar
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!started.setup) {
    return (
      <div className="space-y-3">
        {started.error && (
          <p role="alert" className="text-sm text-red-700">
            {started.error}
          </p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            Instala en tu teléfono una app de autenticación: Google Authenticator o Microsoft Authenticator
            (gratis).
          </li>
          <li>Escanea con ella el código QR que te mostramos.</li>
          <li>Escribe el código de 6 dígitos que aparece en la app.</li>
        </ol>
        <button
          type="button"
          className="btn-primary"
          disabled={pending}
          onClick={() => startTransition(async () => setStarted(await startMfaSetupAction()))}
        >
          {pending ? "Preparando…" : "Mostrar el código QR"}
        </button>
      </div>
    );
  }

  const { secret, qr } = started.setup;
  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
      <div className="space-y-2">
        <svg
          viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
          className="size-52 rounded-lg border border-slate-200 bg-white"
          role="img"
          aria-label="Código QR para la app de autenticación"
          shapeRendering="crispEdges"
        >
          <path d={qr.d} fill="#0f172a" />
        </svg>
        <p className="max-w-52 text-xs text-slate-500">
          ¿No puedes escanear? En la app elige «Ingresar clave» y escribe:
          <span className="mt-1 block font-mono text-slate-800" data-testid="clave-2fa">
            {secret.match(/.{1,4}/g)?.join(" ")}
          </span>
        </p>
      </div>
      <form action={enable} className="space-y-3" noValidate>
        {enabled.error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {enabled.error}
          </p>
        )}
        <div>
          <label htmlFor="mfa-code" className="label">
            Código de la app
          </label>
          <input
            id="mfa-code"
            name="code"
            className="input w-40 text-center text-lg tracking-[0.3em] tabular-nums"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
        </div>
        <Submit />
      </form>
    </div>
  );
}
