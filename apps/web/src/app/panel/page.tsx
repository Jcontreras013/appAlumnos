import { formatRtn, isRegionalRole, ROLE_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SchoolLogo } from "@/components/school-logo";
import { getSession } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { MODULES } from "@/lib/modules";

export const metadata: Metadata = { title: "Inicio" };

export default async function PanelHome() {
  const { user, school, accessToken } = await getSession();
  // Las direcciones departamental y distrital empiezan en su tablero de centros.
  if (isRegionalRole(user.role)) redirect("/panel/region");
  // Las familias van directo a ver a sus hijos.
  if (user.role === "padre" && !user.mustChangePassword) redirect("/panel/familia");
  const firstName = user.name.split(" ")[0];

  if (user.role === "superadmin") {
    const schools = await identity.listSchools(accessToken);
    const active = schools.filter((s) => s.active).length;
    return (
      <div className="space-y-8">
        <PageTitle title={`Hola, ${firstName}`} subtitle="Panel del equipo de la plataforma" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Colegios activos" value={active} />
          <Stat label="Colegios desactivados" value={schools.length - active} />
          <div className="card flex items-center justify-center p-5">
            <Link href="/panel/colegios" className="btn-primary">
              Administrar colegios
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const modules = MODULES.filter((m) => m.roles.includes(user.role));
  return (
    <div className="space-y-8">
      <PageTitle title={`Hola, ${firstName}`} subtitle={ROLE_LABELS[user.role]} />

      {school && (
        <section className="card flex flex-wrap items-center gap-5 p-5">
          <SchoolLogo school={school} className="size-16" />
          <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[2fr_1fr_1.3fr]">
            <Info label="Colegio" value={school.name} wrap />
            <Info label="RTN" value={formatRtn(school.rtn)} />
            <Info label="Identificador" value={school.slug} mono />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Módulos</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((m) => {
            const body = (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{m.label}</h3>
                  {m.href ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                      Disponible
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Fase {m.phase}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600">{m.description}</p>
              </>
            );
            return m.href ? (
              <Link
                key={m.key}
                href={m.href}
                className="card block p-5 transition hover:border-brand-500 hover:shadow-md"
              >
                {body}
              </Link>
            ) : (
              <article key={m.key} className="card p-5 opacity-80">
                {body}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function Info({
  label,
  value,
  mono = false,
  wrap = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-sm text-slate-900 ${wrap ? "" : "truncate"} ${mono ? "font-mono" : "font-medium"}`}
      >
        {value}
      </p>
    </div>
  );
}
