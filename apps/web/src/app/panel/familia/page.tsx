import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Mis hijos" };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

export default async function FamilyHomePage() {
  const session = await requireRole("padre");
  const children = await academic.familyChildren(session.accessToken);
  const firstName = session.user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Hola, {firstName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Notas, asistencia y tareas de tus hijos en {session.school?.name}.
        </p>
      </div>

      {children.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Tu cuenta todavía no tiene alumnos asociados en este centro. Comunícate con la secretaría.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {children.map((c) => (
            <Link
              key={c.studentId}
              href={`/panel/familia/${c.studentId}`}
              className="card block space-y-4 p-5 transition hover:border-brand-500 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{c.name}</h2>
                  <p className="text-sm text-slate-500">{c.sectionLabel ?? "Sin matrícula vigente"}</p>
                </div>
                {c.subjectsAtRisk.length > 0 || c.absences30d >= 5 ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                    Necesita apoyo
                  </span>
                ) : (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    Va bien
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label={c.periodName ?? "Parcial"} value={c.periodAverage ?? "—"} hint="promedio" />
                <Stat
                  label="Asistencia"
                  value={pct(c.attendanceRate30d)}
                  hint={`${c.absences30d} ${c.absences30d === 1 ? "falta" : "faltas"} (30 días)`}
                />
                <Stat label="Tareas" value={c.homeworkThisWeek} hint="esta semana" />
              </dl>
              {c.subjectsAtRisk.length > 0 && (
                <p className="text-sm text-red-800">Va bajo en: {c.subjectsAtRisk.join(", ")}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums text-slate-900">{value}</dd>
      <dd className="text-[11px] text-slate-500">{hint}</dd>
    </div>
  );
}
