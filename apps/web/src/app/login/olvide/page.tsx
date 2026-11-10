import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "¿Olvidaste tu contraseña?" };

/**
 * Muchas cuentas (familias y personal de escuelas públicas) no tienen correo: la contraseña la
 * restablece quien está a cargo, con una temporal que se cambia al entrar.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="card w-full max-w-lg space-y-5 p-6 sm:p-8">
        <div>
          <p className="text-sm font-semibold text-brand-700">{APP_NAME}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">¿Olvidaste tu contraseña?</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pide una contraseña temporal a quien está a cargo. Con ella entras y eliges una nueva.
          </p>
        </div>
        <ul className="space-y-3 text-sm">
          <li className="rounded-lg bg-slate-50 p-3">
            <strong className="text-slate-900">Familias:</strong> a la secretaría o la dirección de la
            escuela.
          </li>
          <li className="rounded-lg bg-slate-50 p-3">
            <strong className="text-slate-900">Maestros y personal:</strong> a la dirección de tu centro.
          </li>
          <li className="rounded-lg bg-slate-50 p-3">
            <strong className="text-slate-900">Directores:</strong> a la dirección distrital o departamental.
          </li>
        </ul>
        <p className="text-xs text-slate-500">
          Si escribiste mal la contraseña varias veces, la cuenta se bloquea 15 minutos por seguridad. Espera
          o pide una contraseña temporal (también desbloquea la cuenta).
        </p>
        <Link href="/login" className="btn-secondary">
          Volver a iniciar sesión
        </Link>
      </div>
    </main>
  );
}
