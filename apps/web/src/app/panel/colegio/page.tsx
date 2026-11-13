import { formatRtn } from "@escolar/shared";
import type { Metadata } from "next";
import { SchoolLogo } from "@/components/school-logo";
import { requireRole } from "@/lib/dal";
import { removeLogoAction } from "./actions";
import { LogoForm } from "./logo-form";

export const metadata: Metadata = { title: "Mi centro" };

export default async function SchoolSettingsPage() {
  const { school } = await requireRole("admin");
  if (!school) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mi centro</h1>
        <p className="mt-1 text-sm text-slate-500">
          El logo aparece en el panel de todo el personal y las familias, y en los documentos en PDF.
        </p>
      </div>

      <section className="card flex flex-wrap items-center gap-5 p-5">
        <SchoolLogo school={school} className="size-24" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-slate-900">{school.name}</p>
          <p className="text-sm text-slate-500">RTN {formatRtn(school.rtn)}</p>
          <p className="font-mono text-xs text-slate-400">{school.slug}</p>
        </div>
        {school.logoVersion && (
          <form action={removeLogoAction}>
            <button type="submit" className="text-xs font-semibold text-slate-500 hover:text-red-700">
              Quitar logo
            </button>
          </form>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-semibold text-slate-900">
          {school.logoVersion ? "Cambiar logo" : "Subir logo"}
        </h2>
        <LogoForm />
      </section>
    </div>
  );
}
