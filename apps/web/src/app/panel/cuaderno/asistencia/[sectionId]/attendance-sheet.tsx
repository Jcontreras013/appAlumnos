"use client";

import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  type AttendanceSheetDto,
  type AttendanceStatus,
  addDays,
  formatDay,
} from "@escolar/shared";
import { useEffect, useState } from "react";
import { SyncStatus } from "@/components/offline";
import { localToday } from "@/lib/offline/ids";
import { pendingFor, record, startSync } from "@/lib/offline/sync";

type Statuses = Record<string, AttendanceStatus | null>;

const SHORT: Record<AttendanceStatus, string> = { presente: "P", ausente: "A", tarde: "T", justificada: "J" };
const ACTIVE: Record<AttendanceStatus, string> = {
  presente: "bg-brand-600 text-white border-brand-600",
  ausente: "bg-red-600 text-white border-red-600",
  tarde: "bg-amber-500 text-white border-amber-500",
  justificada: "bg-sky-600 text-white border-sky-600",
};

/** Una copia guardada sin internet de más de 10 minutos puede ser de otro día. */
const STALE_MS = 10 * 60 * 1000;

export function AttendanceSheet({
  owner,
  sheet,
  requestedDate,
  renderedAt,
  serverToday,
}: {
  owner: string;
  sheet: AttendanceSheetDto;
  /** Hoy en Honduras según el servidor (no se calcula al renderizar: el servidor está en UTC). */
  serverToday: string;
  /** La fecha que pidió la dirección (?fecha=); null = hoy. */
  requestedDate: string | null;
  renderedAt: number;
}) {
  const sectionId = sheet.section.id;
  const fromServer = (): Statuses => Object.fromEntries(sheet.students.map((s) => [s.studentId, s.status]));
  const [date, setDate] = useState(sheet.date);
  const [statuses, setStatuses] = useState<Statuses>(fromServer);
  const [rolled, setRolled] = useState(false);

  useEffect(() => {
    startSync(owner);
    let day = sheet.date;
    let base: Statuses = Object.fromEntries(sheet.students.map((s) => [s.studentId, s.status]));
    // Se abrió "la lista de hoy" desde una copia guardada de otro día (sin internet): es la lista de hoy,
    // con los mismos alumnos y sin marcar.
    const today = localToday();
    if (!requestedDate && day < today && Date.now() - renderedAt > STALE_MS) {
      day = today;
      base = Object.fromEntries(sheet.students.map((s) => [s.studentId, null]));
      setRolled(true);
    }
    setDate(day);
    let alive = true;
    pendingFor(owner, `asistencia:${sectionId}:${day}`)
      .then((records) => {
        if (!alive) return;
        const next = { ...base };
        for (const r of records) {
          if (r.op.kind !== "attendance.put") continue;
          for (const e of r.op.input.entries) if (e.studentId in next) next[e.studentId] = e.status;
        }
        setStatuses(next);
      })
      .catch(() => setStatuses(base));
    return () => {
      alive = false;
    };
  }, [owner, sheet, sectionId, requestedDate, renderedAt]);

  function mark(entries: Array<{ studentId: string; status: AttendanceStatus }>) {
    if (!sheet.canEdit || entries.length === 0) return;
    setStatuses((prev) => {
      const next = { ...prev };
      for (const e of entries) next[e.studentId] = e.status;
      return next;
    });
    void record(
      owner,
      entries.map((e) => ({
        key: `att:${sectionId}:${date}:${e.studentId}`,
        scope: `asistencia:${sectionId}:${date}`,
        op: { kind: "attendance.put", input: { sectionId, date, entries: [e] } },
      })),
    );
  }

  const totals = { presente: 0, ausente: 0, tarde: 0, justificada: 0, sin_registro: 0 };
  for (const s of sheet.students) totals[statuses[s.studentId] ?? "sin_registro"]++;
  const unmarked = sheet.students.filter((s) => !statuses[s.studentId]);
  const today = rolled ? date : serverToday;
  const base = `/panel/cuaderno/asistencia/${sectionId}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <a
            href={`${base}?fecha=${addDays(date, -1)}`}
            className="btn-secondary px-3 py-1.5"
            aria-label="Día anterior"
          >
            ←
          </a>
          <form className="flex items-center gap-1" action={base}>
            <input
              type="date"
              name="fecha"
              defaultValue={date}
              max={today}
              aria-label="Fecha"
              className="input w-40 py-1.5"
            />
            <button type="submit" className="btn-secondary px-3 py-1.5">
              Ver
            </button>
          </form>
          {date < today && (
            <a
              href={`${base}?fecha=${addDays(date, 1)}`}
              className="btn-secondary px-3 py-1.5"
              aria-label="Día siguiente"
            >
              →
            </a>
          )}
        </div>
        <SyncStatus />
      </div>

      <p className="text-sm font-medium text-slate-700">
        {date === today ? "Hoy, " : ""}
        {formatDay(date)}
        {rolled && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Sin conexión: lista de hoy con los alumnos guardados
          </span>
        )}
      </p>

      <section className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {ATTENDANCE_STATUSES.map((s) => (
          <Count
            key={s}
            label={s === "justificada" ? "Justificadas" : `${ATTENDANCE_LABELS[s]}s`}
            value={totals[s]}
          />
        ))}
        <Count label="Sin marcar" value={totals.sin_registro} alert={totals.sin_registro > 0} />
      </section>

      {sheet.canEdit && unmarked.length > 0 && sheet.students.length > 0 && (
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => mark(unmarked.map((s) => ({ studentId: s.studentId, status: "presente" })))}
        >
          {unmarked.length === sheet.students.length
            ? "Todos presentes"
            : `Presentes los demás (${unmarked.length})`}
        </button>
      )}

      <section className="card divide-y divide-slate-100">
        {sheet.students.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-500">
            Esta sección no tiene alumnos matriculados.
          </p>
        )}
        {sheet.students.map((s, i) => {
          const current = statuses[s.studentId] ?? null;
          return (
            <div
              key={s.studentId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4"
            >
              <span className="min-w-0 flex-1 text-sm">
                <span className="mr-2 tabular-nums text-slate-400">{i + 1}.</span>
                <span className="font-medium text-slate-900">{s.name}</span>
              </span>
              <fieldset className="flex gap-1" disabled={!sheet.canEdit}>
                <legend className="sr-only">Asistencia de {s.name}</legend>
                {ATTENDANCE_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={current === status}
                    aria-label={`${s.name}: ${ATTENDANCE_LABELS[status]}`}
                    title={ATTENDANCE_LABELS[status]}
                    onClick={() => mark([{ studentId: s.studentId, status }])}
                    className={`size-10 rounded-lg border text-sm font-bold transition disabled:cursor-default ${
                      current === status
                        ? ACTIVE[status]
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {SHORT[status]}
                  </button>
                ))}
              </fieldset>
            </div>
          );
        })}
      </section>
      <p className="text-xs text-slate-500">
        P = presente · A = ausente · T = llegó tarde (cuenta como asistencia) · J = ausencia justificada (no
        afecta su porcentaje). Cada toque se guarda en el dispositivo y se envía solo.
      </p>
    </div>
  );
}

function Count({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${alert ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
