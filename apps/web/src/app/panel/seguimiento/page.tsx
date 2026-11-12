import { formatDay, isIsoDate, RISK_RULES, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Kpi } from "@/components/kpi";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Seguimiento" };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

export default async function FollowUpPage({ searchParams }: PageProps<"/panel/seguimiento">) {
  const session = await requireRole("admin", "coordinador", "secretaria");
  const token = session.accessToken;
  const query = await searchParams;
  const raw = Array.isArray(query.fecha) ? query.fecha[0] : query.fecha;
  const fecha = raw && isIsoDate(raw) ? raw : todayInHonduras();

  const [data, sections, periodInfo] = await Promise.all([
    academic.followUp(token, fecha),
    academic.listSections(token).catch(() => []),
    academic.periods(token).catch(() => null),
  ]);
  const { period, gradeProgress, attendance, studentsAtRisk, daysToClose } = data;
  const pending = gradeProgress.total - gradeProgress.complete;
  const behind = daysToClose !== null && daysToClose <= 7 && pending > 0;
  const items = [...gradeProgress.items].sort(
    (a, b) =>
      Number(a.complete) - Number(b.complete) ||
      a.assignment.sectionLabel.localeCompare(b.assignment.sectionLabel) ||
      a.assignment.subjectName.localeCompare(b.assignment.subjectName),
  );

  if (!period) {
    return (
      <div className="space-y-4">
        <Title subtitle="Sin año lectivo vigente" />
        <div className="card p-8 text-center text-sm text-slate-500">
          Configura el año lectivo en «Estructura académica» para ver el avance de notas y la asistencia.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Title
        subtitle={
          <>
            {period.name} ({formatDay(period.startsOn)} al {formatDay(period.endsOn)}) · Cierre de notas{" "}
            {formatDay(period.closesOn)}
            {daysToClose !== null &&
              (daysToClose >= 0
                ? ` · faltan ${daysToClose} ${daysToClose === 1 ? "día" : "días"}`
                : ` · cerró hace ${-daysToClose} ${daysToClose === -1 ? "día" : "días"}`)}
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Clases con notas completas"
          value={`${gradeProgress.complete} / ${gradeProgress.total}`}
          tone={behind ? "alert" : pending === 0 && gradeProgress.total > 0 ? "ok" : "neutral"}
          hint={pending > 0 ? `${pending} por completar` : "listas para el SACE"}
        />
        <Kpi label="Asistencia (7 días)" value={pct(attendance.rate7d)} hint="tarde cuenta como asistió" />
        <Kpi
          label="Asistencia tomada hoy"
          value={`${attendance.sectionsRecordedToday} / ${attendance.sections}`}
          hint="secciones"
        />
        <Kpi
          label="Alumnos en riesgo"
          value={studentsAtRisk.length}
          tone={studentsAtRisk.length > 0 ? "alert" : "ok"}
          hint="por faltas o notas"
        />
      </section>

      {behind && (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">
            {daysToClose !== null && daysToClose >= 0
              ? `Faltan ${daysToClose} ${daysToClose === 1 ? "día" : "días"} para el cierre de notas`
              : "Ya pasó el cierre de notas"}{" "}
            y {pending} {pending === 1 ? "clase no tiene" : "clases no tienen"} las notas completas.
          </p>
          <p className="mt-1">Los maestros pueden completarlas desde «Mi cuaderno», aun sin internet.</p>
        </section>
      )}

      <section className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Planificación de esta semana</h2>
          <p className="mt-1 text-sm text-slate-600">
            <strong className="text-slate-900">
              {data.plans.delivered} de {data.plans.total}
            </strong>{" "}
            clases entregadas · {data.plans.approved} aprobadas
            {data.plans.overdue > 0 && (
              <span className="font-semibold text-red-700"> · {data.plans.overdue} atrasadas</span>
            )}{" "}
            <span className="text-slate-400">(vencía el {formatDay(data.plans.deadline)})</span>
          </p>
        </div>
        <Link href="/panel/planificacion" className="btn-secondary px-3 py-1.5">
          Ver planificaciones
        </Link>
      </section>

      <Card
        title="Alumnos en riesgo"
        hint={`Asistencia de los últimos ${RISK_RULES.attendanceWindowDays} días y proyección de notas del parcial`}
      >
        {studentsAtRisk.length === 0 ? (
          <Empty>Ningún alumno en riesgo con lo registrado hasta ahora.</Empty>
        ) : (
          <Table head={["Alumno", "Sección", "Asistencia", "Faltas", "Va reprobando"]}>
            {studentsAtRisk.map((s) => (
              <tr key={s.studentId}>
                <td className="px-4 py-3 font-medium text-slate-900">
                  <Link href={`/panel/alumnos/${s.studentId}`} className="hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{s.sectionLabel}</td>
                <td
                  className={`px-4 py-3 tabular-nums ${
                    s.attendanceRate !== null && s.attendanceRate < RISK_RULES.minAttendanceRate
                      ? "font-semibold text-red-700"
                      : ""
                  }`}
                >
                  {pct(s.attendanceRate)}
                </td>
                <td
                  className={`px-4 py-3 tabular-nums ${s.absences >= RISK_RULES.maxAbsences ? "font-semibold text-red-700" : ""}`}
                >
                  {s.absences}
                </td>
                <td className="px-4 py-3">
                  {s.failing.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    s.failing.map((f) => (
                      <span
                        key={f.subjectName}
                        className="mr-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800"
                      >
                        {f.subjectName} ≈ {f.projected}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Avance de notas por clase"
        hint="Completa = se repartieron los 100 puntos y todos los alumnos tienen nota"
      >
        {items.length === 0 ? (
          <Empty>No hay clases asignadas este año.</Empty>
        ) : (
          <Table head={["Sección", "Materia", "Docente", "Puntos repartidos", "Alumnos con notas", ""]}>
            {items.map((i) => (
              <tr key={i.assignment.id}>
                <td className="whitespace-nowrap px-4 py-3">{i.assignment.sectionLabel}</td>
                <td className="px-4 py-3">
                  <a
                    href={`/panel/cuaderno/notas/${i.assignment.id}?periodo=${period.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {i.assignment.subjectName}
                  </a>
                </td>
                <td className="px-4 py-3">{i.assignment.teacherName}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full ${i.possible >= 100 ? "bg-brand-500" : "bg-amber-400"}`}
                        style={{ width: `${Math.min(i.possible, 100)}%` }}
                      />
                    </div>
                    <span className="tabular-nums">{i.possible}</span>
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {i.studentsComplete} / {i.students}
                </td>
                <td className="px-4 py-3">
                  {i.complete ? (
                    <span className="whitespace-nowrap rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                      Completa
                    </span>
                  ) : i.activities === 0 ? (
                    <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                      Sin actividades
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      En proceso
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {sections.length > 0 && periodInfo && (
        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">Cuadro de calificaciones para el SACE</h2>
          <p className="mt-1 text-sm text-slate-500">
            Descarga la nota de cada alumno por materia (con su número de identidad) para pasarla al SACE o
            imprimirla. Se descarga en Excel, con la identidad completa (sin perder el cero inicial).
          </p>
          <form action="/panel/seguimiento/cuadro" className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="cuadro-seccion" className="label">
                Sección
              </label>
              <select id="cuadro-seccion" name="seccion" className="input w-56" required>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cuadro-periodo" className="label">
                Parcial
              </label>
              <select id="cuadro-periodo" name="periodo" className="input w-40" defaultValue={period.id}>
                {periodInfo.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary">
              Descargar cuadro
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function Title({ subtitle }: { subtitle: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Seguimiento del centro</h1>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
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

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-6 text-center text-sm text-slate-500">{children}</p>
);
