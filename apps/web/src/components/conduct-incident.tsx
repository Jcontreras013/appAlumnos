import {
  CONDUCT_CATEGORY_LABELS,
  CONDUCT_MEASURE_LABELS,
  CONDUCT_SEVERITY_LABELS,
  type ConductIncidentDto,
  type ConductMeasureKind,
  type ConductRecordDto,
  type ConductSeverity,
  formatDay,
} from "@escolar/shared";
import Link from "next/link";
import { CancelMeasureButton, DeleteIncidentButton, MeasureForm } from "@/components/conduct-forms";

export const SEVERITY_STYLES: Record<ConductSeverity, string> = {
  leve: "bg-slate-100 text-slate-700",
  grave: "bg-amber-100 text-amber-900",
  muy_grave: "bg-red-100 text-red-800",
};

export const MEASURE_STYLES: Record<ConductMeasureKind, string> = {
  llamado_atencion: "bg-slate-100 text-slate-700",
  citacion_familia: "bg-sky-50 text-sky-800",
  compromiso: "bg-brand-50 text-brand-700",
  suspension: "bg-amber-100 text-amber-900",
  expulsion: "bg-red-600 text-white",
};

export function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

/** Fechas de una medida: un día, o del primero al último en una suspensión. */
export const measureDates = (m: { startsOn: string; endsOn: string | null }) =>
  m.endsOn && m.endsOn !== m.startsOn
    ? `${formatDay(m.startsOn)} al ${formatDay(m.endsOn)}`
    : formatDay(m.startsOn);

/**
 * Un incidente con sus medidas. Con `can.measure` muestra el formulario para registrar una medida;
 * `showStudent` enlaza al alumno (en la lista del centro).
 */
export function IncidentCard({
  incident,
  can,
  today,
  showStudent = false,
  studentLink = true,
}: {
  incident: ConductIncidentDto;
  can: { measure: boolean; suspendOrExpel: boolean };
  today: string;
  showStudent?: boolean;
  /** El maestro no tiene la ficha del alumno: su nombre no enlaza. */
  studentLink?: boolean;
}) {
  const active = incident.measures.filter((m) => !m.cancelledAt);
  const expelled = active.some((m) => m.kind === "expulsion");
  return (
    <article className="space-y-3 px-4 py-4 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showStudent && (
            <p className="font-semibold text-slate-900">
              {studentLink ? (
                <Link
                  href={`/panel/alumnos/${incident.studentId}`}
                  className="text-brand-700 hover:underline"
                >
                  {incident.studentName}
                </Link>
              ) : (
                incident.studentName
              )}
              {incident.sectionLabel && (
                <span className="ml-2 text-xs font-normal text-slate-500">{incident.sectionLabel}</span>
              )}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-1.5">
            <Pill className={SEVERITY_STYLES[incident.severity]}>
              {CONDUCT_SEVERITY_LABELS[incident.severity]}
            </Pill>
            <span className="font-medium text-slate-900">{CONDUCT_CATEGORY_LABELS[incident.category]}</span>
            <span className="text-xs text-slate-500">
              · {formatDay(incident.date)} · reportó {incident.reportedByName}
            </span>
          </p>
        </div>
        {incident.canDelete && (
          <DeleteIncidentButton incidentId={incident.id} studentId={incident.studentId} />
        )}
      </header>

      <p className="whitespace-pre-wrap text-slate-700">{incident.description}</p>

      {incident.measures.length > 0 && (
        <ul className="space-y-2 border-l-2 border-slate-200 pl-3">
          {incident.measures.map((m) => (
            <li key={m.id} className={m.cancelledAt ? "opacity-60" : undefined}>
              {/* div y no p: «Anular» es un formulario, que no puede ir dentro de un párrafo. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill
                  className={
                    m.cancelledAt ? "bg-slate-100 text-slate-500 line-through" : MEASURE_STYLES[m.kind]
                  }
                >
                  {CONDUCT_MEASURE_LABELS[m.kind]}
                </Pill>
                <span className="text-xs text-slate-600">
                  {measureDates(m)} · decidió {m.decidedByName}
                  {m.cancelledAt && " · anulada"}
                </span>
                {can.suspendOrExpel && !m.cancelledAt && (
                  <CancelMeasureButton
                    measureId={m.id}
                    studentId={incident.studentId}
                    label={CONDUCT_MEASURE_LABELS[m.kind]}
                  />
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-600">Para la familia: {m.notes}</p>
            </li>
          ))}
        </ul>
      )}

      {can.measure && !expelled && (
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {active.length ? "Agregar otra medida" : "Decidir una medida"}
          </summary>
          <div className="border-t border-slate-200 p-3">
            <MeasureForm
              incidentId={incident.id}
              studentId={incident.studentId}
              canSuspendOrExpel={can.suspendOrExpel}
              minDate={incident.date}
              today={today}
            />
          </div>
        </details>
      )}
    </article>
  );
}

/** Medidas como las ve la familia o la departamental: sin la descripción del incidente. */
export function ConductRecordList({ records }: { records: ConductRecordDto[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {records.map((r) => (
        <li key={r.measureId} className="space-y-1 px-4 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-1.5">
            <Pill className={MEASURE_STYLES[r.kind]}>{CONDUCT_MEASURE_LABELS[r.kind]}</Pill>
            <span className="text-xs text-slate-600">{measureDates(r)}</span>
          </p>
          <p className="text-xs text-slate-500">
            Por: {CONDUCT_CATEGORY_LABELS[r.category]} ({CONDUCT_SEVERITY_LABELS[r.severity].toLowerCase()}) ·{" "}
            {formatDay(r.incidentDate)}
          </p>
          <p className="text-slate-700">{r.notes}</p>
        </li>
      ))}
    </ul>
  );
}
