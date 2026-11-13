import { type ScheduleDto, WEEKDAY_LABELS, WEEKDAYS } from "@escolar/shared";

/**
 * Horario semanal en una tabla: una fila por hora de clase y una columna por día. En cada casilla,
 * la materia y debajo el docente (o la sección, en el horario de un docente).
 */
export function ScheduleGrid({ schedule, show }: { schedule: ScheduleDto; show: "teacher" | "section" }) {
  if (schedule.blocks.length === 0) {
    return <p className="text-sm text-slate-500">El centro todavía no definió sus horas de clase.</p>;
  }
  const at = (weekday: number, block: number) =>
    schedule.slots.find((s) => s.weekday === weekday && s.block === block);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-24 py-2 pr-2 font-semibold">Hora</th>
            {WEEKDAYS.map((d) => (
              <th key={d} className="px-2 py-2 font-semibold">
                {WEEKDAY_LABELS[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schedule.blocks.map((b) => (
            <tr key={b.number} className="border-t border-slate-100 align-top">
              <td className="whitespace-nowrap py-2 pr-2 tabular-nums text-slate-500">
                {b.startsAt}–{b.endsAt}
              </td>
              {WEEKDAYS.map((d, i) => {
                const slot = at(i + 1, b.number);
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
