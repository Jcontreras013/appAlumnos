import { formatNationalId, ROLE_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/change-password-form";
import { MfaSetup } from "@/components/mfa-setup";
import { getSession } from "@/lib/dal";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const { user, current, mfa } = await getSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mi cuenta</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.name} · {ROLE_LABELS[user.role]} · {current.scopeName}
        </p>
      </div>
      <section className="card space-y-1 p-5 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Entras con</p>
        {user.email && <p className="font-medium text-slate-900">{user.email}</p>}
        {user.nationalId && (
          <p className="font-medium tabular-nums text-slate-900">{formatNationalId(user.nationalId)}</p>
        )}
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">Cambiar contraseña</h2>
        <ChangePasswordForm />
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold text-slate-900">Verificación en dos pasos</h2>
        {mfa.enabled ? (
          <p className="text-sm text-slate-700">
            <span className="mr-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              Activada
            </span>
            Al entrar te pedimos el código de la app de tu teléfono. Te quedan{" "}
            <strong>{mfa.recoveryCodesLeft}</strong> códigos de recuperación
            {mfa.recoveryCodesLeft <= 3 &&
              ": si se te acaban y pierdes el teléfono, pide al equipo de la plataforma que la restablezca"}
            .
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Opcional para tu cargo: además de la contraseña, al entrar te pediremos un código de tu
              teléfono. Así nadie entra a tu cuenta aunque conozca tu contraseña.
            </p>
            <MfaSetup doneHref="/panel/cuenta" />
          </>
        )}
      </section>
    </div>
  );
}
