import { formatNationalId, ROLE_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/change-password-form";
import { getSession } from "@/lib/dal";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const { user, current } = await getSession();
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
    </div>
  );
}
