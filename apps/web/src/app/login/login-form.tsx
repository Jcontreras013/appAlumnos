"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Field, FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { biometricSaved, readBiometric, rememberForBiometric, removeBiometric } from "@/lib/native-biometric";
import { loginAction } from "./actions";

export function LoginForm({ expired, idle = false }: { expired: boolean; idle?: boolean }) {
  const [state, action] = useActionState(loginAction, initialFormState);
  const form = useRef<HTMLFormElement>(null);
  // En la app de Android, si la persona activó la huella: «Entrar con huella».
  const [fingerprint, setFingerprint] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const viaFingerprint = useRef(false);

  useEffect(() => {
    let alive = true;
    biometricSaved().then((saved) => {
      if (alive) setFingerprint(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Con la huella se mandó una contraseña vieja (la cambió en otro lado): se olvida la guardada.
  useEffect(() => {
    if (!state.error || !viaFingerprint.current) return;
    viaFingerprint.current = false;
    removeBiometric().then(() => {
      setFingerprint(false);
      setNotice(
        "La contraseña guardada con tu huella ya no sirve. Entra con tu contraseña y vuelve a activar la huella.",
      );
    });
  }, [state]);

  async function enterWithFingerprint() {
    setNotice(null);
    const result = await readBiometric();
    if (!result.ok) {
      if (result.reason === "ya-no-sirve") {
        setFingerprint(false);
        setNotice(
          "Las huellas del teléfono cambiaron. Entra con tu contraseña y vuelve a activar la huella.",
        );
      }
      return;
    }
    const el = form.current;
    if (!el) return;
    (el.elements.namedItem("email") as HTMLInputElement).value = result.login;
    (el.elements.namedItem("password") as HTMLInputElement).value = result.password;
    viaFingerprint.current = true;
    el.requestSubmit();
  }

  const shown = notice
    ? { error: notice }
    : !state.error && idle
      ? { error: "Por seguridad, tu sesión se cerró por inactividad. Vuelve a iniciar sesión." }
      : !state.error && expired
        ? { error: "Tu sesión expiró. Vuelve a iniciar sesión." }
        : state;

  return (
    <form
      ref={form}
      action={action}
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        // Para ofrecer la huella al llegar al panel (solo en la app y solo en memoria).
        if (viaFingerprint.current) return;
        const data = new FormData(e.currentTarget);
        rememberForBiometric(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
      }}
    >
      <FormAlert state={shown} />
      {fingerprint && (
        <>
          <button
            type="button"
            onClick={enterWithFingerprint}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3"
          >
            <FingerprintIcon />
            Entrar con huella
          </button>
          <p className="text-center text-xs text-slate-500">
            o escribe tu usuario y tu contraseña ·{" "}
            <button
              type="button"
              className="font-medium text-slate-600 underline"
              onClick={() => removeBiometric().then(() => setFingerprint(false))}
            >
              quitar la huella de este teléfono
            </button>
          </p>
        </>
      )}
      <Field
        name="email"
        label="Usuario, correo o identidad"
        type="text"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="lpaz, nombre@correo.hn o 0801-1985-01234"
        autoComplete="username"
        required
        autoFocus={!fingerprint}
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

export function FingerprintIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 11v3a8 8 0 0 1-1.5 4.7M8.5 7.6A5 5 0 0 1 17 11v1.5M7 11a5 5 0 0 1 .3-1.7M17 15.5a13 13 0 0 1-.8 3.2M12 7a4 4 0 0 0-4 4v1a12 12 0 0 1-1.2 5.2M4.6 7.5A9 9 0 0 1 21 11v1M3 12v-1a9 9 0 0 1 .5-3" />
    </svg>
  );
}
