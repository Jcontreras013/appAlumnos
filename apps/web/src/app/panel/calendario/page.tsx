import {
  DAY_OFF_LABELS,
  type DayOffDto,
  type DayOffKind,
  daysBetween,
  formatDay,
  formatDayOffRange,
  MONTH_NAMES,
} from "@escolar/shared";
import type { Metadata } from "next";
import { DayOffBanner } from "@/components/day-off-banner";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { removeDayOffAction } from "./actions";
import { DayOffForm } from "./day-off-form";

export const metadata: Metadata = { title: "Calendario escolar" };

const KIND_STYLES: Record<DayOffKind, string> = {
  feriado: "bg-amber-100 text-amber-900",
  vacaciones: "bg-sky-100 text-sky-900",
  otro: "bg-slate-100 text-slate-700",
};

/** «Diciembre de 2026» para agrupar por el mes en que empieza cada período. */
const monthOf = (iso: string) => {
  const [year, month] = iso.split("-").map(Number) as [number, number];
  const name = MONTH_NAMES[month - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
};

export default async function CalendarPage() {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const calendar = await academic.calendar(session.accessToken);
  const { schoolYear, daysOff, today, canEdit } = calendar;

  const months = new Map<string, DayOffDto[]>();
  for (const day of daysOff) {
    const key = monthOf(day.startsOn);
    months.set(key, [...(months.get(key) ?? []), day]);
  }
  const weekdays = (d: DayOffDto) => {
    const span = daysBetween(d.startsOn, d.endsOn) + 1;
    return span === 1 ? "1 día" : `${span} días`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Calendario escolar</h1>
        <p className="mt-1 text-sm text-slate-500">
          {schoolYear
            ? `Año lectivo ${schoolYear.name}: del ${formatDay(schoolYear.startsOn)} al ${formatDay(schoolYear.endsOn)}. `
            : ""}
          Feriados y vacaciones del centro. En esos días no se pide asistencia, ninguna clase queda «sin
          maestro» y una semana entera sin clases no pide planificación.
        </p>
      </div>

      {today && <DayOffBanner dayOff={today}>Hoy no hay clases.</DayOffBanner>}

      {!schoolYear ? (
        <p className="card p-6 text-center text-sm text-slate-500">
          Primero hay que configurar el año lectivo en «Año, grados y materias».
        </p>
      ) : (
        <div className={`grid gap-6 ${canEdit ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
          <section className="space-y-4">
            {daysOff.length === 0 ? (
              <p className="card p-6 text-center text-sm text-slate-500">
                {canEdit
                  ? "Todavía no hay feriados ni vacaciones marcados. Agrégalos con el formulario."
                  : "La secretaría todavía no ha marcado feriados ni vacaciones."}
              </p>
            ) : (
              [...months.entries()].map(([month, days]) => (
                <div key={month} className="card overflow-hidden">
                  <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                    {month}
                  </h2>
                  <ul className="divide-y divide-slate-100">
                    {days.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLES[d.kind]}`}
                        >
                          {DAY_OFF_LABELS[d.kind]}
                        </span>
                        <span className="font-medium text-slate-900">{d.name}</span>
                        <span className="text-sm text-slate-500">
                          {formatDayOffRange(d, formatDay)} · {weekdays(d)}
                        </span>
                        {canEdit && (
                          <form action={removeDayOffAction} className="ml-auto">
                            <input type="hidden" name="id" value={d.id} />
                            <button
                              type="submit"
                              className="text-xs font-semibold text-slate-500 hover:text-red-700"
                              aria-label={`Quitar ${d.name} del calendario`}
                            >
                              Quitar
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
          {canEdit && (
            <aside className="card h-fit p-5">
              <h2 className="mb-1 font-semibold text-slate-900">Agregar días sin clases</h2>
              <p className="mb-4 text-sm text-slate-500">
                Un feriado es un solo día; para vacaciones, marca desde y hasta.
              </p>
              <DayOffForm min={schoolYear.startsOn} max={schoolYear.endsOn} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
