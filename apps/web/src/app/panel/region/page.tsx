import {
  formatDay,
  isIsoDate,
  type RegionalOverviewDto,
  type RegionalSchoolSummaryDto,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { KpiPanel } from "@/components/kpi-panel";
import { FilterBar, FilterEmpty, FilterRow, FilterScope } from "@/components/quick-filter";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Tablero de centros" };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

/** Totales de los centros que se ven (con el filtro de distrito), igual que los calcula academic. */
function totalsOf(schools: RegionalSchoolSummaryDto[]): RegionalOverviewDto["totals"] {
  const sum = (pick: (s: RegionalSchoolSummaryDto) => number) => schools.reduce((acc, s) => acc + pick(s), 0);
  const withData = schools.filter((s) => s.attendanceRate7d !== null && s.students > 0);
  const weight = withData.reduce((acc, s) => acc + s.students, 0);
  return {
    schools: schools.length,
    students: sum((s) => s.students),
    sections: sum((s) => s.sections),
    teachers: sum((s) => s.teachers),
    classes: sum((s) => s.classes),
    teachersOnLeave: sum((s) => s.teachersOnLeave),
    uncoveredClasses: sum((s) => s.uncoveredClasses),
    schoolsWithUncoveredClasses: schools.filter((s) => s.uncoveredClasses > 0).length,
    studentsAtRisk: sum((s) => s.studentsAtRisk),
    schoolsBehindOnGrades: schools.filter((s) => s.behindOnGrades).length,
    plansDelivered: sum((s) => s.plans.delivered),
    plansTotal: sum((s) => s.plans.total),
    plansOverdue: sum((s) => s.plans.overdue),
    attendanceRate7d: weight
      ? withData.reduce((acc, s) => acc + (s.attendanceRate7d ?? 0) * s.students, 0) / weight
      : null,
  };
}

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
    .sort(
      (a, b) =>
        b.uncoveredClasses - a.uncoveredClasses ||
        Number(b.behindOnGrades) - Number(a.behindOnGrades) ||
        b.studentsAtRisk - a.studentsAtRisk ||
        a.schoolName.localeCompare(b.schoolName),
    );
  const alerts = schools.filter((s) => s.uncoveredClasses > 0);
  const behind = schools.filter((s) => s.behindOnGrades);
  // Con un distrito elegido, los indicadores son los de ese distrito (no los del departamento).
  const t = distrito ? totalsOf(schools) : overview.totals;
  const href = (s: RegionalSchoolSummaryDto) => `/panel/region/${s.schoolId}?fecha=${fecha}` as const;
  const by = (pick: (s: RegionalSchoolSummaryDto) => number) =>
    [...schools].sort((a, b) => pick(b) - pick(a) || a.schoolName.localeCompare(b.schoolName));
  const list = (rows: RegionalSchoolSummaryDto[], value: (s: RegionalSchoolSummaryDto) => ReactNode) => (
    <CenterList rows={rows.map((s) => ({ s, href: href(s), value: value(s) }))} />
  );
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
          {session.user.role === "director_departamental" && (
            <Link href="/panel/region/importar" className="btn-secondary">
              Cargar centros
            </Link>
          )}
          <Link href="/panel/region/indicadores" className="btn-secondary">
            Indicadores del piloto
          </Link>
          <a href="/panel/region/exportar" className="btn-secondary" download>
            Descargar Excel
          </a>
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
        <KpiPanel
          label="Centros"
          value={t.schools}
          hint={districts.length ? `${districts.length} distritos` : undefined}
          title="Centros"
          subtitle="Toca un centro para ver su detalle."
        >
          {list(
            [...schools].sort((a, b) => a.schoolName.localeCompare(b.schoolName)),
            (s) => `${s.students} alumnos`,
          )}
        </KpiPanel>
        <KpiPanel
          label="Alumnos matriculados"
          value={t.students.toLocaleString("es-HN")}
          title="Alumnos matriculados por centro"
        >
          {list(
            by((s) => s.students),
            (s) => `${s.students} en ${s.sections} ${s.sections === 1 ? "sección" : "secciones"}`,
          )}
        </KpiPanel>
        <KpiPanel
          label="Maestros"
          value={t.teachers}
          hint={`${t.classes} clases asignadas`}
          title="Maestros por centro"
        >
          {list(
            by((s) => s.teachers),
            (s) => `${s.teachers} maestros · ${s.classes} clases`,
          )}
        </KpiPanel>
        <KpiPanel
          label="Maestros con licencia"
          value={t.teachersOnLeave}
          hint={isToday ? "hoy" : formatDay(fecha)}
          title="Centros con maestros de licencia"
          subtitle={isToday ? "Hoy" : formatDay(fecha)}
        >
          {list(
            by((s) => s.teachersOnLeave).filter((s) => s.teachersOnLeave > 0),
            (s) =>
              `${s.teachersOnLeave} con licencia${s.uncoveredClasses ? ` · ${s.uncoveredClasses} clases sin maestro` : ""}`,
          )}
        </KpiPanel>
        <KpiPanel
          label="Clases sin maestro"
          value={t.uncoveredClasses}
          tone={t.uncoveredClasses > 0 ? "alert" : "ok"}
          hint={
            t.uncoveredClasses > 0
              ? `en ${t.schoolsWithUncoveredClasses} ${t.schoolsWithUncoveredClasses === 1 ? "centro" : "centros"}`
              : "todas cubiertas"
          }
          title="Centros con clases sin maestro"
          subtitle="Dentro de cada centro, «Clases sin maestro» dice cuáles son."
        >
          {list(
            by((s) => s.uncoveredClasses).filter((s) => s.uncoveredClasses > 0),
            (s) => (
              <span className="font-semibold text-red-700">{s.uncoveredClasses} sin maestro</span>
            ),
          )}
        </KpiPanel>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiPanel
          label="Asistencia (7 días)"
          value={pct(t.attendanceRate7d)}
          hint="de los centros que la registran"
          title="Asistencia de los últimos 7 días"
          subtitle="De la más baja a la más alta."
        >
          {list(
            [...schools].sort((a, b) => (a.attendanceRate7d ?? 2) - (b.attendanceRate7d ?? 2)),
            (s) =>
              s.attendanceRate7d === null ? (
                <span className="text-slate-400">no registra</span>
              ) : (
                <span className={s.attendanceRate7d < 0.85 ? "font-semibold text-red-700" : ""}>
                  {pct(s.attendanceRate7d)}
                </span>
              ),
          )}
        </KpiPanel>
        <KpiPanel
          label="Alumnos en riesgo"
          value={t.studentsAtRisk.toLocaleString("es-HN")}
          tone={t.studentsAtRisk > 0 ? "alert" : "ok"}
          hint="por faltas o notas bajas, antes del cierre"
          cta="Ver por centro →"
          title="Alumnos en riesgo por centro"
          subtitle="Dentro de cada centro, «Alumnos en riesgo» dice quiénes son y abre su ficha."
        >
          {list(
            by((s) => s.studentsAtRisk).filter((s) => s.studentsAtRisk > 0),
            (s) => (
              <span className="font-semibold text-red-700">{s.studentsAtRisk} en riesgo</span>
            ),
          )}
        </KpiPanel>
        <KpiPanel
          label="Centros atrasados con notas"
          value={t.schoolsBehindOnGrades}
          tone={t.schoolsBehindOnGrades > 0 ? "alert" : "ok"}
          hint="el cierre está a 7 días o menos"
          title="Centros atrasados con las notas"
          subtitle="El cierre está a 7 días o menos y hay clases con notas incompletas."
        >
          {list(
            behind,
            (s) =>
              `${s.gradeProgress.complete} de ${s.gradeProgress.total} completas${s.periodClosesOn ? ` · cierre ${formatDay(s.periodClosesOn)}` : ""}`,
          )}
        </KpiPanel>
        <KpiPanel
          label="Planificaciones de la semana"
          value={t.plansTotal ? `${Math.round((t.plansDelivered / t.plansTotal) * 100)}%` : "—"}
          tone={t.plansOverdue > 0 ? "alert" : "neutral"}
          hint={`${t.plansDelivered} de ${t.plansTotal} entregadas${t.plansOverdue ? ` · ${t.plansOverdue} atrasadas` : ""}`}
          title="Planificaciones de la semana por centro"
          subtitle="Los centros con más planificaciones atrasadas van primero."
        >
          {list(
            by((s) => s.plans.overdue).filter((s) => s.plans.total > 0),
            (s) => (
              <span className={s.plans.overdue > 0 ? "font-semibold text-red-700" : ""}>
                {s.plans.delivered} de {s.plans.total} entregadas
                {s.plans.overdue > 0 && ` · ${s.plans.overdue} atrasadas`}
              </span>
            ),
          )}
        </KpiPanel>
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

      {behind.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Centros con el cierre de notas encima y notas incompletas</p>
          <ul className="mt-2 space-y-1">
            {behind.map((s) => (
              <li key={s.schoolId}>
                <Link href={`/panel/region/${s.schoolId}?fecha=${fecha}`} className="font-medium underline">
                  {s.schoolName}
                </Link>
                : {s.gradeProgress.complete} de {s.gradeProgress.total} clases con notas completas
                {s.periodClosesOn ? ` (cierre ${formatDay(s.periodClosesOn)})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        {schools.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No hay centros en este ámbito todavía.</p>
        ) : (
          <FilterScope items={schools.map((s) => ({ text: `${s.schoolName} ${s.districtName ?? ""}` }))}>
            <FilterBar placeholder="Buscar centro o distrito" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="min-w-64 px-4 py-3 font-semibold">Centro</th>
                    <th className="px-4 py-3 text-right font-semibold">Alumnos</th>
                    <th className="px-4 py-3 text-right font-semibold">Maestros</th>
                    <th className="px-4 py-3 font-semibold">Clases</th>
                    <th className="px-4 py-3 text-right font-semibold">Asistencia</th>
                    <th className="px-4 py-3 text-right font-semibold">En riesgo</th>
                    <th className="px-4 py-3 font-semibold">Notas y planificación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schools.map((s) => (
                    <FilterRow
                      key={s.schoolId}
                      text={`${s.schoolName} ${s.districtName ?? ""}`}
                      className="hover:bg-slate-50"
                    >
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
                      <td className="px-4 py-3 text-right tabular-nums">
                        {s.students}
                        <span className="block whitespace-nowrap text-xs text-slate-500">
                          {s.sections} {s.sections === 1 ? "sección" : "secciones"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {s.teachers}
                        {s.teachersOnLeave > 0 && (
                          <span className="block whitespace-nowrap text-xs text-amber-700">
                            {s.teachersOnLeave} con licencia
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.uncoveredClasses > 0 ? (
                          <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                            {s.uncoveredClasses} sin maestro
                          </span>
                        ) : (
                          <span className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                            {s.classes > 0 ? "Todas cubiertas" : "Sin clases asignadas"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{pct(s.attendanceRate7d)}</td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${s.studentsAtRisk > 0 ? "font-semibold text-red-700" : ""}`}
                      >
                        {s.studentsAtRisk}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {s.gradeProgress.total === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              s.behindOnGrades
                                ? "bg-amber-100 text-amber-900"
                                : s.gradeProgress.complete === s.gradeProgress.total
                                  ? "bg-brand-50 text-brand-700"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                            title={s.periodName ?? undefined}
                          >
                            {s.gradeProgress.complete}/{s.gradeProgress.total} completas
                          </span>
                        )}
                        {s.plans.total > 0 && (
                          <span
                            className={`mt-1 block text-xs ${s.plans.overdue > 0 ? "font-semibold text-red-700" : "text-slate-500"}`}
                          >
                            Planificación {s.plans.delivered}/{s.plans.total}
                          </span>
                        )}
                      </td>
                    </FilterRow>
                  ))}
                </tbody>
              </table>
            </div>
            <FilterEmpty message="Ningún centro coincide con la búsqueda." />
          </FilterScope>
        )}
      </section>
    </div>
  );
}

/** Lista de centros dentro de un cuadro flotante: cada fila lleva al detalle del centro. */
function CenterList({
  rows,
}: {
  rows: Array<{ s: RegionalSchoolSummaryDto; href: string; value: ReactNode }>;
}) {
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-slate-500">Ningún centro en esta situación.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(({ s, href, value }) => (
        <li key={s.schoolId}>
          <Link
            href={href as `/panel/region/${string}`}
            className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50"
          >
            <span className="min-w-0">
              <span className="block font-medium text-brand-700">{s.schoolName}</span>
              <span className="block text-xs text-slate-500">
                {s.districtName ? `Distrito ${s.districtName}` : "Sin distrito"}
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums text-slate-700">{value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
