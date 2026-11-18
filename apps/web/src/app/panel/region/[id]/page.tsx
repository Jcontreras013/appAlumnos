import {
  FOLLOW_UP_LABELS,
  formatDay,
  formatNationalId,
  isIsoDate,
  LEAVE_TYPE_LABELS,
  PLAN_STATUS_LABELS,
  ROLE_LABELS,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AccountEditor } from "@/components/account-editor";
import { KpiPanel } from "@/components/kpi-panel";
import { ResetPassword } from "@/components/reset-password";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { CoverageTable } from "./coverage-table";

export const metadata: Metadata = { title: "Detalle del centro" };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const PLAN_ORDER = ["sin_iniciar", "borrador", "devuelta", "enviada", "aprobada"] as const;

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
  const { summary, coverage, sections, studentsAtRisk, gradeProgress, plans, attendanceBySection } = detail;
  // Personal del centro (para ayudar a quien olvidó su contraseña o quedó bloqueado).
  const staff = await identity.schoolStaff(session.accessToken, id).catch(() => []);

  // Lo que hay detrás de cada indicador, ordenado para que lo que pide atención quede arriba.
  const teachers = new Map<string, { name: string; classes: string[]; onLeave: boolean }>();
  for (const r of coverage.rows) {
    const t = teachers.get(r.assignment.teacherUserId) ?? {
      name: r.assignment.teacherName,
      classes: [],
      onLeave: false,
    };
    t.classes.push(`${r.assignment.sectionLabel} · ${r.assignment.subjectName}`);
    t.onLeave ||= r.leave !== null;
    teachers.set(r.assignment.teacherUserId, t);
  }
  const leaves = new Map<
    string,
    { name: string; type: string; startsOn: string; endsOn: string; classes: number; covered: number }
  >();
  for (const r of coverage.rows) {
    if (!r.leave) continue;
    const l = leaves.get(r.leave.id) ?? {
      name: r.assignment.teacherName,
      type: LEAVE_TYPE_LABELS[r.leave.type],
      startsOn: r.leave.startsOn,
      endsOn: r.leave.endsOn,
      classes: 0,
      covered: 0,
    };
    l.classes += 1;
    if (r.substitute) l.covered += 1;
    leaves.set(r.leave.id, l);
  }
  const uncovered = coverage.rows.filter((r) => r.status === "sin_cubrir");
  const grades = [...gradeProgress].sort((a, b) => Number(a.complete) - Number(b.complete));
  const weekPlans = [...plans].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) || PLAN_ORDER.indexOf(a.status) - PLAN_ORDER.indexOf(b.status),
  );
  const studentHref = (studentId: string) =>
    `/panel/region/${summary.schoolId}/alumnos/${studentId}?fecha=${fecha}` as const;

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
        <KpiPanel
          label="Alumnos"
          value={summary.students}
          hint={`${summary.sections} secciones`}
          title="Alumnos matriculados"
          subtitle={`${summary.students} alumnos en ${summary.sections} secciones`}
        >
          <PanelTable head={["Sección", "Alumnos", "Cupo"]} empty="El centro no tiene secciones este año.">
            {sections.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">{s.label}</td>
                <td className="px-4 py-2 tabular-nums">{s.enrolledCount}</td>
                <td className="px-4 py-2 tabular-nums text-slate-500">{s.capacity ?? "—"}</td>
              </tr>
            ))}
          </PanelTable>
        </KpiPanel>
        <KpiPanel
          label="Maestros"
          value={summary.teachers}
          hint={`${summary.classes} clases`}
          title="Maestros y sus clases"
          subtitle={`${summary.teachers} maestros dan ${summary.classes} clases`}
        >
          <PanelTable head={["Maestro", "Clases"]} empty="El centro todavía no asignó maestros.">
            {[...teachers.entries()]
              .sort(([, a], [, b]) => a.name.localeCompare(b.name))
              .map(([teacherId, t]) => (
                <tr key={teacherId} className="align-top">
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-900">{t.name}</span>
                    {t.onLeave && (
                      <span className="ml-2">
                        <Badge tone="amber">Con licencia</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    <span className="font-medium text-slate-900">{t.classes.length}</span> ·{" "}
                    {t.classes.join(", ")}
                  </td>
                </tr>
              ))}
          </PanelTable>
        </KpiPanel>
        <KpiPanel
          label="Con licencia"
          value={summary.teachersOnLeave}
          title="Maestros con licencia"
          subtitle={`Licencias vigentes el ${formatDay(fecha)}`}
        >
          <PanelTable
            head={["Maestro", "Licencia", "Clases cubiertas"]}
            empty="Nadie está de licencia ese día."
          >
            {[...leaves.entries()].map(([leaveId, l]) => (
              <tr key={leaveId}>
                <td className="px-4 py-2 font-medium text-slate-900">{l.name}</td>
                <td className="px-4 py-2 text-slate-600">
                  {l.type} · {formatDay(l.startsOn)} al {formatDay(l.endsOn)}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  <span className={l.covered < l.classes ? "font-semibold text-red-700" : ""}>
                    {l.covered} de {l.classes}
                  </span>
                </td>
              </tr>
            ))}
          </PanelTable>
        </KpiPanel>
        <KpiPanel
          label="Clases sin maestro"
          value={summary.uncoveredClasses}
          tone={summary.uncoveredClasses > 0 ? "alert" : "ok"}
          title="Clases sin maestro"
          subtitle="El titular está de licencia y el centro no ha asignado quién lo cubre."
        >
          <PanelTable
            head={["Sección", "Materia", "Titular", "Licencia"]}
            empty="Todas las clases tienen maestro ese día."
          >
            {uncovered.map((r) => (
              <tr key={r.assignment.id}>
                <td className="whitespace-nowrap px-4 py-2">{r.assignment.sectionLabel}</td>
                <td className="px-4 py-2">{r.assignment.subjectName}</td>
                <td className="px-4 py-2">{r.assignment.teacherName}</td>
                <td className="px-4 py-2 text-slate-600">
                  {r.leave && `${LEAVE_TYPE_LABELS[r.leave.type]} hasta el ${formatDay(r.leave.endsOn)}`}
                </td>
              </tr>
            ))}
          </PanelTable>
        </KpiPanel>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiPanel
          label="Asistencia (7 días)"
          value={pct(summary.attendanceRate7d)}
          hint={summary.attendanceRate7d === null ? "el centro no registra asistencia" : "de los alumnos"}
          title="Asistencia de los últimos 7 días"
          subtitle="Por sección, de la más baja a la más alta. «Tarde» cuenta como asistió."
        >
          <PanelTable
            head={["Sección", "Asistencia", "Días con lista"]}
            empty="El centro no tiene secciones."
          >
            {attendanceBySection.map((a) => (
              <tr key={a.sectionId}>
                <td className="px-4 py-2">{a.sectionLabel}</td>
                <td
                  className={`px-4 py-2 tabular-nums ${a.rate !== null && a.rate < 0.85 ? "font-semibold text-red-700" : ""}`}
                >
                  {a.rate === null ? <span className="text-slate-400">sin lista</span> : pct(a.rate)}
                </td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{a.recordedDays}</td>
              </tr>
            ))}
          </PanelTable>
        </KpiPanel>
        <KpiPanel
          label="Alumnos en riesgo"
          value={summary.studentsAtRisk}
          tone={summary.studentsAtRisk > 0 ? "alert" : "ok"}
          hint="por faltas o notas bajas"
          cta="Ver quiénes →"
          title="Alumnos en riesgo"
          subtitle="Asistencia de los últimos 30 días, materias que va reprobando y si la escuela ya le dio seguimiento. Toca un alumno para ver su ficha."
        >
          {studentsAtRisk.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              Ningún alumno en riesgo con lo registrado hasta ahora.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {studentsAtRisk.map((s) => (
                <li key={s.studentId}>
                  <Link
                    href={studentHref(s.studentId)}
                    className="block px-5 py-3 text-sm hover:bg-slate-50 focus-visible:bg-slate-50"
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-semibold text-brand-700">{s.name}</span>
                      <span className="text-xs text-slate-500">{s.sectionLabel}</span>
                    </span>
                    <span className="mt-1 block text-slate-600">
                      Asistencia{" "}
                      <span
                        className={
                          s.attendanceRate !== null && s.attendanceRate < 0.85
                            ? "font-semibold text-red-700"
                            : ""
                        }
                      >
                        {pct(s.attendanceRate)}
                      </span>{" "}
                      ·{" "}
                      <span className={s.absences >= 5 ? "font-semibold text-red-700" : ""}>
                        {s.absences} {s.absences === 1 ? "falta" : "faltas"}
                      </span>{" "}
                      ·{" "}
                      {s.lastFollowUp ? (
                        <span>
                          {FOLLOW_UP_LABELS[s.lastFollowUp.kind]} el {formatDay(s.lastFollowUp.date)}
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700">Sin seguimiento</span>
                      )}
                    </span>
                    {s.failing.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {s.failing.map((f) => (
                          <Badge key={f.subjectName} tone="red">
                            {f.subjectName} ≈ {f.projected}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </KpiPanel>
        <KpiPanel
          label={`Notas ${summary.periodName ?? "del parcial"}`}
          value={`${summary.gradeProgress.complete} / ${summary.gradeProgress.total}`}
          tone={summary.behindOnGrades ? "alert" : "neutral"}
          hint={
            summary.periodClosesOn
              ? `clases completas · cierre ${formatDay(summary.periodClosesOn)}`
              : "clases completas"
          }
          title={`Notas del ${summary.periodName ?? "parcial"}`}
          subtitle="Completa = 100 puntos repartidos y todos los alumnos con nota. Las pendientes van primero."
        >
          <PanelTable
            head={["Clase", "Maestro", "Puntos", "Alumnos con notas", "Estado"]}
            empty="No hay clases asignadas este año."
          >
            {grades.map((g) => (
              <tr key={g.assignment.id}>
                <td className="px-4 py-2">
                  {g.assignment.subjectName}
                  <span className="block text-xs text-slate-500">{g.assignment.sectionLabel}</span>
                </td>
                <td className="px-4 py-2 text-slate-600">{g.assignment.teacherName}</td>
                <td className="px-4 py-2 tabular-nums">{g.possible} / 100</td>
                <td className="px-4 py-2 tabular-nums">
                  {g.studentsComplete} / {g.students}
                </td>
                <td className="px-4 py-2">
                  {g.complete ? <Badge tone="green">Completa</Badge> : <Badge tone="red">Pendiente</Badge>}
                </td>
              </tr>
            ))}
          </PanelTable>
        </KpiPanel>
        <KpiPanel
          label="Planificaciones de la semana"
          value={`${summary.plans.delivered} / ${summary.plans.total}`}
          tone={summary.plans.overdue > 0 ? "alert" : "neutral"}
          hint={summary.plans.overdue ? `${summary.plans.overdue} atrasadas` : "entregadas a la dirección"}
          title="Planificaciones de la semana"
          subtitle="Las atrasadas y las que faltan por entregar van primero."
        >
          <PanelTable head={["Clase", "Maestro", "Estado"]} empty="No hay clases asignadas este año.">
            {weekPlans.map((p) => (
              <tr key={p.assignment.id}>
                <td className="px-4 py-2">
                  {p.assignment.subjectName}
                  <span className="block text-xs text-slate-500">{p.assignment.sectionLabel}</span>
                </td>
                <td className="px-4 py-2 text-slate-600">{p.assignment.teacherName}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={p.status === "aprobada" ? "green" : p.overdue ? "red" : "slate"}>
                      {PLAN_STATUS_LABELS[p.status]}
                    </Badge>
                    {p.overdue && <Badge tone="red">Atrasada</Badge>}
                  </span>
                </td>
              </tr>
            ))}
          </PanelTable>
        </KpiPanel>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          ¿Quién da cada clase?
        </h2>
        <CoverageTable rows={coverage.rows} />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          Dirección y personal
        </h2>
        {staff.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            El centro todavía no tiene personal cargado.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {staff.map((u) => (
              <li
                key={`${u.id}-${u.role}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-medium text-slate-900">{u.name}</span>
                  <span className="block text-xs text-slate-500">
                    {ROLE_LABELS[u.role]} · {u.nationalId ? formatNationalId(u.nationalId) : u.email}
                    {!u.active && " · desactivado"}
                  </span>
                </span>
                {u.active && (
                  <span className="space-y-1 text-right">
                    <ResetPassword userId={u.id} name={u.name} />
                    <AccountEditor user={u} />
                  </span>
                )}
              </li>
            ))}
          </ul>
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

/** Tabla de un cuadro flotante, con un mensaje cuando no hay filas. */
function PanelTable({ head, empty, children }: { head: string[]; empty: string; children: ReactNode[] }) {
  if (children.length === 0) return <p className="px-5 py-8 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

const BADGE_TONES = {
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-brand-50 text-brand-700",
  slate: "bg-slate-100 text-slate-700",
} as const;

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span
      className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold first:ml-0 ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
