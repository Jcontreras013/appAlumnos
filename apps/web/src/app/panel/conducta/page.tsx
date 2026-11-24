import { CONDUCT_CATEGORY_LABELS, CONDUCT_SEVERITY_LABELS, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import { ReportIncidentForm } from "@/components/conduct-forms";
import { IncidentCard } from "@/components/conduct-incident";
import { Kpi } from "@/components/kpi";
import { FilterBar, FilterEmpty, FilterRow, FilterScope } from "@/components/quick-filter";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Conducta" };

/**
 * Conducta del centro: incidentes del año lectivo y las medidas que decidió el centro. El maestro
 * reporta y ve sus propios reportes; la dirección y la coordinación deciden las medidas.
 */
export default async function ConductPage() {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const token = session.accessToken;
  const today = todayInHonduras();
  const [data, students] = await Promise.all([
    academic.conduct(token),
    academic.conductStudents(token).catch(() => []),
  ]);
  const { incidents, totals, can } = data;
  const isTeacher = session.user.role === "docente";
  const pending = incidents.filter((i) => i.measures.every((m) => m.cancelledAt)).length;
  const textOf = (i: (typeof incidents)[number]) =>
    [
      i.studentName,
      i.sectionLabel,
      CONDUCT_SEVERITY_LABELS[i.severity],
      CONDUCT_CATEGORY_LABELS[i.category],
      i.reportedByName,
    ]
      .filter(Boolean)
      .join(" ");
  const stateOf = (i: (typeof incidents)[number]) =>
    i.measures.some((m) => !m.cancelledAt) ? "con_medida" : "sin_medida";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Conducta</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          {isTeacher
            ? "Reporta los incidentes de tus alumnos. La dirección o la coordinación deciden las medidas y la familia las ve en su portal."
            : "Incidentes del año lectivo y las medidas que decidió el centro, según su reglamento interno. La familia ve las medidas, no la descripción del incidente."}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Incidentes" value={totals.last30Days} hint="últimos 30 días" />
        {isTeacher ? (
          <Kpi label="Esperan decisión" value={pending} hint="reportes tuyos sin medida" />
        ) : (
          <Kpi
            label="Esperan decisión"
            value={pending}
            tone={pending > 0 && can.measure ? "alert" : "neutral"}
            hint="incidentes sin medida"
          />
        )}
        <Kpi label="Suspensiones vigentes" value={totals.activeSuspensions} hint="hoy" />
        <Kpi
          label="Expulsiones"
          value={totals.expulsions}
          tone={totals.expulsions > 0 ? "alert" : "neutral"}
          hint="en el año lectivo"
        />
      </section>

      {can.report && (
        <section className="card">
          <details open={incidents.length === 0}>
            <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-slate-900 hover:bg-slate-50">
              Reportar un incidente
            </summary>
            <div className="border-t border-slate-200 p-4">
              {students.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {isTeacher
                    ? "No tienes alumnos asignados este año: puedes reportar a los alumnos de las secciones donde das clases."
                    : "No hay alumnos matriculados en el año vigente."}
                </p>
              ) : (
                <ReportIncidentForm students={students} today={today} />
              )}
            </div>
          </details>
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          {isTeacher ? "Tus reportes del año" : "Incidentes del año"}
        </h2>
        {incidents.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            Todavía no hay incidentes registrados este año.
          </p>
        ) : (
          <FilterScope items={incidents.map((i) => ({ text: textOf(i), group: stateOf(i) }))}>
            <FilterBar
              placeholder="Buscar alumno, sección, tipo de falta o quién reportó"
              groups={[
                { value: "sin_medida", label: "Esperan decisión" },
                { value: "con_medida", label: "Con medida" },
              ]}
              groupLabel="Estado"
              allLabel="Todos"
            />
            <ul className="divide-y divide-slate-100">
              {incidents.map((i) => (
                <FilterRow key={i.id} as="li" text={textOf(i)} group={stateOf(i)}>
                  <IncidentCard incident={i} can={can} today={today} showStudent studentLink={!isTeacher} />
                </FilterRow>
              ))}
            </ul>
            <FilterEmpty message="Ningún incidente coincide con la búsqueda." />
          </FilterScope>
        )}
      </section>
    </div>
  );
}
