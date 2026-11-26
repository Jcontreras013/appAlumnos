"use client";

import { useEffect, useState } from "react";
import { FingerprintIcon } from "@/app/login/login-form";
import {
  biometricReady,
  biometricSaved,
  clearPendingBiometric,
  declined,
  markDeclined,
  pendingBiometric,
  saveBiometric,
} from "@/lib/native-biometric";

type State =
  | { kind: "oculto" }
  | { kind: "ofrecer"; login: string; password: string }
  | { kind: "listo" }
  | { kind: "error"; login: string; password: string };

/**
 * Recién entrado con la contraseña en la app de Android: ofrece entrar con la huella la próxima vez.
 * Solo si el teléfono tiene huella (o rostro) registrada, todavía no se activó y la persona no dijo
 * «Ahora no» antes.
 */
export function BiometricOffer() {
  const [state, setState] = useState<State>({ kind: "oculto" });

  useEffect(() => {
    const pending = pendingBiometric();
    if (!pending?.login || !pending.password || declined()) {
      clearPendingBiometric();
      return;
    }
    let alive = true;
    (async () => {
      const offer = (await biometricReady()) && !(await biometricSaved());
      if (!alive) return;
      // Se olvidan de la memoria en cuanto se usan (o si no hay nada que ofrecer).
      clearPendingBiometric();
      if (offer) setState({ kind: "ofrecer", ...pending });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "oculto") return null;
  if (state.kind === "listo") {
    return (
      <div role="status" className="card mb-6 p-4 text-sm text-brand-900">
        Listo: la próxima vez toca «Entrar con huella».
      </div>
    );
  }

  const activate = async () => {
    try {
      await saveBiometric(state.login, state.password);
      setState({ kind: "listo" });
    } catch {
      setState({ kind: "error", login: state.login, password: state.password });
    }
  };

  return (
    <section className="card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3 text-sm">
        <span className="mt-0.5 text-brand-700">
          <FingerprintIcon />
        </span>
        <div>
          <p className="font-medium text-slate-900">¿Entrar con tu huella la próxima vez?</p>
          <p className="mt-0.5 text-slate-500">
            {state.kind === "error"
              ? "No se pudo activar. Inténtalo de nuevo."
              : "Tu contraseña queda guardada en este teléfono y solo se abre con tu huella."}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            markDeclined();
            setState({ kind: "oculto" });
          }}
        >
          Ahora no
        </button>
        <button type="button" className="btn-primary" onClick={activate}>
          Activar huella
        </button>
      </div>
    </section>
  );
}
