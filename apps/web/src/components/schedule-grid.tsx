import { DEFAULT_CLASS_DAYS, type ScheduleDto, WEEKDAY_LABELS, weekdayOf } from "@escolar/shared";

/**
 * Horario semanal en una tabla: una fila por hora de clase y una columna por día de clase (los de la
 * jornada: lunes a viernes, sábado y domingo…). En cada casilla, la materia y debajo el docente (o la
 * sección, en el horario de un docente). Un docente con clases en varias jornadas ve un horario por
 * jornada, cada uno con sus horas.
 */
export function ScheduleGrid({ schedule, show }: { schedule: ScheduleDto; show: "teacher" | "section" }) {
  if (schedule.shifts && schedule.shifts.length > 1) {
    return (
      <div className="space-y-6">
        {schedule.shifts.map((g) => (
          <div key={g.shiftName ?? "-"} className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">{g.shiftName ?? "Jornada regular"}</h3>
            <Grid blocks={g.blocks} slots={g.slots} classDays={g.classDays} show={show} />
          </div>
        ))}
      </div>
    );
  }
  return <Grid blocks={schedule.blocks} slots={schedule.slots} classDays={schedule.classDays} show={show} />;
}

function Grid({
  blocks,
  slots,
  classDays,
  show,
}: Pick<ScheduleDto, "blocks" | "slots"> & { classDays?: number[]; show: "teacher" | "section" }) {
  if (blocks.length === 0) {
    return (
      <p className="text-sm text-slate-500">Todavía no se definieron las horas de clase de esta jornada.</p>
    );
  }
  const days = classDays?.length ? classDays : [...DEFAULT_CLASS_DAYS];
  const at = (weekday: number, block: number) =>
    slots.find((s) => s.weekday === weekday && s.block === block);
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${days.length > 3 ? "min-w-[40rem]" : ""}`}>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-24 py-2 pr-2 font-semibold">Hora</th>
            {days.map((d) => (
              <th key={d} className="px-2 py-2 font-semibold">
                {WEEKDAY_LABELS[weekdayOf(d)]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.number} className="border-t border-slate-100 align-top">
              <td className="whitespace-nowrap py-2 pr-2 tabular-nums text-slate-500">
                {b.startsAt}–{b.endsAt}
              </td>
              {days.map((d) => {
                const slot = at(d, b.number);
                return (
                  <td key={d} className="px-2 py-2">
                    {slot ? (
                      <div className="rounded-md bg-brand-50 px-2 py-1">
                        <p className="font-medium text-brand-900">{slot.subjectName}</p>
                        <p className="text-xs text-brand-700">
                          {show === "teacher" ? slot.teacherName : slot.sectionLabel}
                        </p>
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
