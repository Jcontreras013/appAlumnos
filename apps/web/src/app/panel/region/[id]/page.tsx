import { COVERAGE_LABELS, formatDay, isIsoDate, LEAVE_TYPE_LABELS, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Kpi } from "@/components/kpi";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Detalle del centro" };

const STATUS_STYLES = {
  normal: "bg-slate-100 text-slate-700",
  cubierta: "bg-amber-50 text-amber-800",
  sin_cubrir: "bg-red-100 text-red-800",
} as const;

export default async function RegionSchoolPage({ params, searchParams }: PageProps<"/panel/region/[id]">) {
  const session = await requireRole("director_departamental", "director_distrital", "superadmin");
  const { id } = await params;
  const query = await searchParams;
  const raw = Array.isArray(query.fecha) ? query.fecha[0] : query.fecha;
  const fecha = raw && isIsoDate(raw) ? raw : todayInHonduras();

  const detail = await academic.regionalSchool(session.accessToken, id, fecha).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const { summary, coverage, sections } = detail;
  const rows = [...coverage.rows].sort(
    (a, b) =>
      ["sin_cubrir", "cubierta", "normal"].indexOf(a.status) -
      ["sin_cubrir", "cubierta", "normal"].indexOf(b.status),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/panel/region?fecha=${fecha}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Tablero de centros
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <SchoolLogo
            school={{ id: summary.schoolId, name: summary.schoolName, logoVersion: summary.logoVersion }}
            scoped
            className="size-16"
          />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{summary.schoolName}</h1>
            <p className="text-sm text-slate-500">
              {summary.districtName ? `Distrito ${summary.districtName}` : "Sin distrito"} ·{" "}
              {summary.schoolYear ? `Año lectivo ${summary.schoolYear}` : "Sin año lectivo configurado"} ·{" "}
              {formatDay(fecha)}
            </p>
          </div>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Alumnos" value={summary.students} hint={`${summary.sections} secciones`} />
        <Kpi label="Maestros" value={summary.teachers} hint={`${summary.classes} clases`} />
        <Kpi label="Con licencia" value={summary.teachersOnLeave} />
        <Kpi
          label="Clases sin maestro"
          value={summary.uncoveredClasses}
          tone={summary.uncoveredClasses > 0 ? "alert" : "ok"}
        />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          ¿Quién da cada clase?
        </h2>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            El centro todavía no asignó maestros a sus clases.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Sección</th>
                  <th className="px-4 py-2 font-semibold">Materia</th>
                  <th className="px-4 py-2 font-semibold">Maestro titular</th>
                  <th className="px-4 py-2 font-semibold">Situación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.assignment.id}>
                    <td className="whitespace-nowrap px-4 py-2">{r.assignment.sectionLabel}</td>
                    <td className="px-4 py-2">{r.assignment.subjectName}</td>
                    <td className="px-4 py-2">{r.assignment.teacherName}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status]}`}
                      >
                        {COVERAGE_LABELS[r.status]}
                      </span>
                      {r.leave && (
                        <p className="mt-1 text-xs text-slate-500">
                          {LEAVE_TYPE_LABELS[r.leave.type]} hasta el {formatDay(r.leave.endsOn)}
                          {r.substitute && ` · cubre ${r.substitute.substituteName}`}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          Matrícula por sección
        </h2>
        <ul className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between bg-white px-4 py-3 text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums text-slate-600">
                {s.enrolledCount}
                {s.capacity !== null ? ` / ${s.capacity}` : ""} alumnos
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
