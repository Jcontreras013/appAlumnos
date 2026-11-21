import { DAY_OFF_LABELS, type DayOffDto, formatDay, formatDayOffRange } from "@escolar/shared";

/** Aviso de «hoy no hay clases» (feriado, vacaciones) del calendario escolar. */
export function DayOffBanner({ dayOff, children }: { dayOff: DayOffDto; children?: React.ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <p className="font-semibold">
        {DAY_OFF_LABELS[dayOff.kind]}: {dayOff.name}{" "}
        <span className="font-normal text-sky-800">({formatDayOffRange(dayOff, formatDay)})</span>
      </p>
      {children && <p className="mt-0.5 text-sky-800">{children}</p>}
    </div>
  );
}
