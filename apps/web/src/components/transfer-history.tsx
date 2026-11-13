import { formatDay, type TransferDto } from "@escolar/shared";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

/** Cómo iba el alumno en el centro de donde viene: nota de cada parcial por materia y asistencia. */
export function TransferHistory({ transfer }: { transfer: TransferDto }) {
  const { history } = transfer.snapshot;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-700">
        Viene de <strong>{transfer.fromSchoolName}</strong>
        {history.sectionLabel && ` (${history.sectionLabel}, año ${history.schoolYearName})`}, trasladado el{" "}
        {formatDay(transfer.date)}.{transfer.notes && ` ${transfer.notes}`}
      </p>
      {history.subjects.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-semibold">Materia</th>
                {history.periods.map((p) => (
                  <th key={p} className="px-2 py-1 text-center font-semibold">
                    {p.replace(" Parcial", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.subjects.map((s) => (
                <tr key={s.name}>
                  <td className="py-1 pr-2">{s.name}</td>
                  {s.grades.map((g, i) => (
                    <td key={history.periods[i]} className="px-2 py-1 text-center tabular-nums">
                      {g ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Asistencia en el centro anterior: {pct(history.attendance.rate)} ({history.attendance.absent}{" "}
        ausencias en {history.attendance.days} días registrados).
      </p>
    </div>
  );
}
