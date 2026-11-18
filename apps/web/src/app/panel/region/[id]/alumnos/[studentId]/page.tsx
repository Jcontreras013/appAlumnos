import {
  ATTENDANCE_LABELS,
  FOLLOW_UP_LABELS,
  formatDay,
  formatNationalId,
  formatWeekRange,
  isIsoDate,
  mondayOf,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Kpi } from "@/components/kpi";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Ficha del alumno" };

const UUID = /^[0-9a-f-]{36}$/i;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const STATUS_STYLES = {
  presente: "bg-brand-50 text-brand-700",
  ausente: "bg-red-100 text-red-800",
  tarde: "bg-amber-50 text-amber-900",
  justificada: "bg-sky-50 text-sky-800",
} as const;

/**
 * Ficha de un alumno vista desde la departamental o distrital (solo lectura): por qué está en
 * riesgo, sus notas y asistencia, y lo que ha hecho la escuela. El seguimiento lo registra el centro.
 */
export default async function RegionStudentPage({
  params,
  searchParams,
}: PageProps<"/panel/region/[id]/alumnos/[studentId]">) {
  const session = await requireRole("director_departamental", "director_distrital", "superadmin");
  const { id, studentId } = await params;
  if (!UUID.test(id) || !UUID.test(studentId)) notFound();
  const query = await searchParams;
  const raw = Array.isArray(query.fecha) ? query.fecha[0] : query.fecha;
  const fecha = raw && isIsoDate(raw) ? raw : todayInHonduras();

  const data = await academic.regionalStudent(session.accessToken, id, studentId, fecha).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const { school, child, risk, followUps } = data;
  const { student, period, subjects, attendance, homework, passingGrade, periods } = child;
  const week = mondayOf(fecha);
  const projected = subjects
    .map((s) => (period ? s.grades[period.id]?.projected : null))
    .filter((p): p is number => p !== null && p !== undefined);
  const periodAverage = projected.length
    ? Math.round(projected.reduce((a, b) => a + b, 0) / projected.length)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/panel/region/${school.id}?fecha=${fecha}`}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← {school.name}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <SchoolLogo school={school} scoped className="size-14" />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{student.name}</h1>
            <p className="text-sm text-slate-500">
              {student.sectionLabel ?? "Sin matrícula vigente"} · {school.name}
              {school.districtName && ` · Distrito ${school.districtName}`}
              {student.nationalId && ` · Identidad ${formatNationalId(student.nationalId)}`}
            </p>
          </div>
        </div>
      </div>

      {risk ? (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">En riesgo al {formatDay(fecha)}</p>
          <ul className="mt-1 list-disc pl-5">
            {risk.absences >= 5 && <li>{risk.absences} ausencias en los últimos 30 días.</li>}
            {risk.attendanceRate !== null && risk.attendanceRate < 0.85 && (
              <li>Asistencia del {pct(risk.attendanceRate)} en los últimos 30 días (mínimo 85 %).</li>
            )}
            {risk.failing.map((f) => (
              <li key={f.subjectName}>
                {f.subjectName}: va con {f.projected} (la nota mínima es {passingGrade}).
              </li>
            ))}
          </ul>
          <p className="mt-2 text-red-800">
            {followUps.length === 0
              ? "La escuela todavía no ha registrado seguimiento."
              : `La escuela registró ${followUps.length} ${followUps.length === 1 ? "acción" : "acciones"} de seguimiento (abajo).`}
          </p>
        </section>
      ) : (
        <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          Al {formatDay(fecha)} no está en riesgo por faltas ni por notas.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={`Promedio ${period?.name ?? "del parcial"}`}
          value={periodAverage ?? "—"}
          hint="con lo evaluado hasta ahora"
          tone={periodAverage !== null && periodAverage < passingGrade ? "alert" : "neutral"}
        />
        <Kpi label="Asistencia" value={pct(attendance.rate30d)} hint="últimos 30 días" />
        <Kpi
          label="Faltas"
          value={attendance.absences30d}
          hint={`${plural(attendance.tardies30d, "llegada tarde", "llegadas tarde")} · ${plural(attendance.justified30d, "justificada", "justificadas")}`}
          tone={attendance.absences30d >= 5 ? "alert" : "neutral"}
        />
        <Kpi label="Promedio del año" value={child.generalAverage ?? "—"} hint="parciales cerrados" />
      </section>

      <Card title="Seguimiento de la escuela">
        {followUps.length === 0 ? (
          <Empty>
            Sin anotaciones. El seguimiento lo registra la dirección o la coordinación del centro.
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {followUps.map((f) => (
              <li key={f.id} className="px-4 py-3 text-sm">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-900">{FOLLOW_UP_LABELS[f.kind]}</span>
                  <span className="text-xs text-slate-500">
                    {formatDay(f.date)} · {f.authorName}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{f.notes}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Notas por materia">
        {subjects.length === 0 ? (
          <Empty>Todavía no hay materias asignadas.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Materia</th>
                  {periods.map((p) => (
                    <th key={p.id} className="px-3 py-2 text-right font-semibold">
                      {p.name.replace(" Parcial", "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subjects.map((s) => (
                  <tr key={s.assignmentId}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-900">{s.subjectName}</span>
                      <span className="block text-xs text-slate-500">{s.teacherName}</span>
                    </td>
                    {periods.map((p) => {
                      const g = s.grades[p.id];
                      const value = g?.grade ?? g?.projected ?? null;
                      const inProgress = g?.grade === null && g?.projected !== null;
                      return (
                        <td
                          key={p.id}
                          className={`px-3 py-2 text-right tabular-nums ${value !== null && value < passingGrade ? "font-semibold text-red-700" : ""}`}
                        >
                          {value === null ? (
                            <span className="text-slate-300">—</span>
                          ) : inProgress ? (
                            <span title="Va con esto, con lo evaluado hasta ahora">({value})</span>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-xs text-slate-500">
              Nota mínima: {passingGrade}. Entre paréntesis, cómo va en el parcial en curso. Las notas
              oficiales son las que el centro registra en el SACE.
            </p>
          </div>
        )}
      </Card>

      <Card title="Asistencia del último mes">
        {attendance.recent.length === 0 ? (
          <Empty>
            {attendance.recordedDays30d > 0
              ? "Asistió todos los días registrados."
              : "Todavía no hay asistencia registrada."}
          </Empty>
        ) : (
          <ul className="flex flex-wrap gap-2 p-4">
            {attendance.recent.map((r) => (
              <li
                key={r.date}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[r.status]}`}
              >
                {formatDay(r.date)} · {ATTENDANCE_LABELS[r.status]}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {homework.length > 0 && (
        <Card title="Tareas y temas">
          <ul className="divide-y divide-slate-100">
            {homework.map((h) => (
              <li key={`${h.subjectName}-${h.weekStart}`} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-900">{h.subjectName}</span>
                  <span className="text-xs text-slate-500">
                    {h.weekStart === week ? "Esta semana" : "Próxima semana"} · {formatWeekRange(h.weekStart)}
                  </span>
                </div>
                {h.topic && <p className="mt-0.5 text-slate-600">Tema: {h.topic}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-slate-500">
        Solo lectura. Cada consulta de esta ficha queda en la bitácora del centro.
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-6 text-center text-sm text-slate-500">{children}</p>
);
