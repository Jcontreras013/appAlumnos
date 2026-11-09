import { formatDay, isIsoDate, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Kpi } from "@/components/kpi";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Tablero de centros" };

export default async function RegionPage({ searchParams }: PageProps<"/panel/region">) {
  const session = await requireRole("director_departamental", "director_distrital", "superadmin");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const fecha = isIsoDate(one(params.fecha)) ? one(params.fecha) : todayInHonduras();
  const distrito = one(params.distrito);

  const overview = await academic.regionalOverview(session.accessToken, fecha);
  const districts = [...new Set(overview.schools.map((s) => s.districtName).filter(Boolean))] as string[];
  const schools = overview.schools
    .filter((s) => !distrito || s.districtName === distrito)
    .sort((a, b) => b.uncoveredClasses - a.uncoveredClasses || a.schoolName.localeCompare(b.schoolName));
  const alerts = schools.filter((s) => s.uncoveredClasses > 0);
  const t = overview.totals;
  const isToday = fecha === todayInHonduras();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tablero de centros</h1>
          <p className="mt-1 text-sm text-slate-500">
            {session.current.scopeName} · {isToday ? "Hoy, " : ""}
            {formatDay(fecha)}
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2">
          {districts.length > 1 && (
            <select name="distrito" defaultValue={distrito} aria-label="Distrito" className="input w-48">
              <option value="">Todos los distritos</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <input type="date" name="fecha" defaultValue={fecha} aria-label="Fecha" className="input w-44" />
          <button type="submit" className="btn-secondary">
            Ver
          </button>
        </form>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label="Centros"
          value={t.schools}
          hint={districts.length ? `${districts.length} distritos` : undefined}
        />
        <Kpi label="Alumnos matriculados" value={t.students.toLocaleString("es-HN")} />
        <Kpi label="Maestros" value={t.teachers} hint={`${t.classes} clases asignadas`} />
        <Kpi
          label="Maestros con licencia"
          value={t.teachersOnLeave}
          hint={isToday ? "hoy" : formatDay(fecha)}
        />
        <Kpi
          label="Clases sin maestro"
          value={t.uncoveredClasses}
          tone={t.uncoveredClasses > 0 ? "alert" : "ok"}
          hint={
            t.uncoveredClasses > 0
              ? `en ${t.schoolsWithUncoveredClasses} ${t.schoolsWithUncoveredClasses === 1 ? "centro" : "centros"}`
              : "todas cubiertas"
          }
        />
      </section>

      {alerts.length > 0 && (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">
            Hay alumnos sin maestro {isToday ? "hoy" : `el ${formatDay(fecha)}`}
          </p>
          <ul className="mt-2 space-y-1">
            {alerts.map((s) => (
              <li key={s.schoolId}>
                <Link href={`/panel/region/${s.schoolId}?fecha=${fecha}`} className="font-medium underline">
                  {s.schoolName}
                </Link>
                : {s.uncoveredClasses} {s.uncoveredClasses === 1 ? "clase" : "clases"} sin sustituto asignado
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        {schools.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No hay centros en este ámbito todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Centro</th>
                  <th className="px-4 py-3 text-right font-semibold">Alumnos</th>
                  <th className="px-4 py-3 text-right font-semibold">Secciones</th>
                  <th className="px-4 py-3 text-right font-semibold">Maestros</th>
                  <th className="px-4 py-3 text-right font-semibold">Con licencia</th>
                  <th className="px-4 py-3 font-semibold">Clases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schools.map((s) => (
                  <tr key={s.schoolId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/panel/region/${s.schoolId}?fecha=${fecha}`}
                        className="flex items-center gap-3 hover:underline"
                      >
                        <SchoolLogo
                          school={{ id: s.schoolId, name: s.schoolName, logoVersion: s.logoVersion }}
                          scoped
                          className="size-9"
                        />
                        <span>
                          <span className="block font-medium text-slate-900">{s.schoolName}</span>
                          <span className="block text-xs text-slate-500">
                            {s.districtName ? `Distrito ${s.districtName}` : "Sin distrito"}
                            {s.schoolYear ? ` · Año ${s.schoolYear}` : " · Sin año lectivo"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.students}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.sections}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.teachers}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{s.teachersOnLeave}</td>
                    <td className="px-4 py-3">
                      {s.uncoveredClasses > 0 ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                          {s.uncoveredClasses} sin maestro
                        </span>
                      ) : (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                          {s.classes > 0 ? "Todas cubiertas" : "Sin clases asignadas"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
