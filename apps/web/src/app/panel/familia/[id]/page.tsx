import { ATTENDANCE_LABELS, formatDay, formatWeekRange, mondayOf, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Kpi } from "@/components/kpi";
import { ScheduleGrid } from "@/components/schedule-grid";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Mi hijo" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const STATUS_STYLES = {
  presente: "bg-brand-50 text-brand-700",
  ausente: "bg-red-100 text-red-800",
  tarde: "bg-amber-50 text-amber-900",
  justificada: "bg-sky-50 text-sky-800",
} as const;

export default async function ChildPage({ params }: PageProps<"/panel/familia/[id]">) {
  const session = await requireRole("padre");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [child, schedule] = await Promise.all([
    academic.familyChild(session.accessToken, id).catch((err) => {
      if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    }),
    academic.childSchedule(session.accessToken, id).catch(() => null),
  ]);
  const { student, period, subjects, attendance, homework, passingGrade } = child;
  const week = mondayOf(todayInHonduras());
  const projected = subjects
    .map((s) => (period ? s.grades[period.id]?.projected : null))
    .filter((p): p is number => p !== null && p !== undefined);
  const periodAverage = projected.length
    ? Math.round(projected.reduce((a, b) => a + b, 0) / projected.length)
    : null;
  const atRisk = subjects.filter((s) => s.atRisk);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/familia" className="text-sm text-slate-500 hover:text-slate-900">
          ← Mis hijos
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{student.name}</h1>
            <p className="text-sm text-slate-500">
              {student.sectionLabel ?? "Sin matrícula vigente"} · Año {student.schoolYearName ?? "—"}
              {period && ` · ${period.name}`}
            </p>
          </div>
          <Link href={`/panel/familia/${student.id}/boleta`} className="btn-secondary">
            Ver boleta
          </Link>
        </div>
      </div>

      {(atRisk.length > 0 || attendance.absences30d >= 5) && (
        <section
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">Conviene hablar con sus maestros</p>
          <ul className="mt-1 list-disc pl-5">
            {atRisk.map((s) => (
              <li key={s.assignmentId}>
                {s.subjectName}: va con {period ? s.grades[period.id]?.projected : "—"} (la nota mínima es{" "}
                {passingGrade}).
              </li>
            ))}
            {attendance.absences30d >= 5 && <li>Faltó {attendance.absences30d} días en el último mes.</li>}
          </ul>
        </section>
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

      <Card title="Tareas y temas">
        {homework.length === 0 ? (
          <Empty>Los maestros todavía no han publicado la planificación de esta semana.</Empty>
        ) : (
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
                {h.homework && (
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-slate-800">
                    {h.homework}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Notas del ${period?.name ?? "parcial"}`}>
        {subjects.length === 0 ? (
          <Empty>Todavía no hay materias asignadas.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {subjects.map((s) => {
              const g = period ? s.grades[period.id] : undefined;
              return (
                <li key={s.assignmentId} className="px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="font-medium text-slate-900">{s.subjectName}</span>
                        <span className="block text-xs text-slate-500">{s.teacherName}</span>
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {g?.grade !== null && g?.grade !== undefined ? (
                          <strong className={g.grade < passingGrade ? "text-red-700" : "text-slate-900"}>
                            {g.grade}
                          </strong>
                        ) : g?.projected !== null && g?.projected !== undefined ? (
                          <span className={s.atRisk ? "font-semibold text-red-700" : "text-slate-900"}>
                            va con {g.projected}
                          </span>
                        ) : (
                          <span className="text-slate-400">sin notas</span>
                        )}
                        {g && (
                          <span className="block text-xs text-slate-500">
                            {g.points} de {g.possible} puntos evaluados
                          </span>
                        )}
                      </span>
                    </summary>
                    {s.activities.length > 0 && (
                      <table className="mt-3 w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {s.activities.map((a) => (
                            <tr key={`${a.name}-${a.date}`}>
                              <td className="py-1.5 pr-2 text-slate-700">{a.name}</td>
                              <td className="py-1.5 pr-2 text-xs text-slate-500">{formatDay(a.date)}</td>
                              <td className="py-1.5 text-right tabular-nums">
                                {a.points === null ? (
                                  <span className="text-amber-700">pendiente</span>
                                ) : (
                                  <>
                                    <strong>{a.points}</strong>
                                    <span className="text-slate-500"> / {a.maxPoints}</span>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
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

      {schedule && schedule.slots.length > 0 && (
        <Card title="Horario de clases">
          <div className="p-4">
            <ScheduleGrid schedule={schedule} show="teacher" />
          </div>
        </Card>
      )}
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
