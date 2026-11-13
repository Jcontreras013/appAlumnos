"use client";

import { type ScheduleDto, WEEKDAY_LABELS, WEEKDAYS } from "@escolar/shared";
import { useActionState, useState, useTransition } from "react";
import { FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { saveBlocksAction, saveSectionScheduleAction } from "./actions";

type Option = { value: string; label: string };

/** Las horas de clase del centro (iguales para todas las secciones). Controlado: guardar no lo vacía. */
export function BlocksForm({ blocks }: { blocks: ScheduleDto["blocks"] }) {
  const [state, action] = useActionState(saveBlocksAction, initialFormState);
  const [rows, setRows] = useState(
    blocks.length
      ? blocks.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt }))
      : [{ startsAt: "07:00", endsAt: "07:45" }],
  );
  const update = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: las horas son posiciones (1.ª, 2.ª…)
            key={i}
            className="grid grid-cols-[2rem_1fr_auto_1fr_1.25rem] items-center gap-1.5 text-sm"
          >
            <span className="text-slate-500">{i + 1}.ª</span>
            <input
              name="startsAt"
              type="time"
              value={r.startsAt}
              onChange={(e) => update(i, { startsAt: e.target.value })}
              aria-label={`${i + 1}.ª hora: inicio`}
              className="input min-w-0 px-2 py-1.5"
            />
            <span className="text-slate-400">a</span>
            <input
              name="endsAt"
              type="time"
              value={r.endsAt}
              onChange={(e) => update(i, { endsAt: e.target.value })}
              aria-label={`${i + 1}.ª hora: fin`}
              className="input min-w-0 px-2 py-1.5"
            />
            {rows.length > 1 && i === rows.length - 1 ? (
              <button
                type="button"
                aria-label="Quitar la última hora"
                className="text-slate-400 hover:text-red-700"
                onClick={() => setRows(rows.slice(0, -1))}
              >
                ×
              </button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        {rows.length < 12 && (
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-sm"
            onClick={() => setRows([...rows, { startsAt: "", endsAt: "" }])}
          >
            Agregar hora
          </button>
        )}
        <SubmitButton pendingText="Guardando…">Guardar horas</SubmitButton>
      </div>
      <p className="text-xs text-slate-500">
        Los recreos no se escriben: basta con que la siguiente hora empiece más tarde.
      </p>
    </form>
  );
}

/** Casilla por casilla: qué clase de la sección va en cada día y hora. */
export function SectionScheduleForm({
  sectionId,
  schedule,
  classes,
}: {
  sectionId: string;
  schedule: ScheduleDto;
  classes: Option[];
}) {
  const [state, action] = useActionState(saveSectionScheduleAction, initialFormState);
  // Controlado: después de guardar se sigue viendo lo elegido (React no vacía selects controlados).
  const [cells, setCells] = useState<Record<string, string>>(() =>
    Object.fromEntries(schedule.slots.map((s) => [`${s.weekday}-${s.block}`, s.assignmentId])),
  );
  const [pending, startTransition] = useTransition();
  return (
    <form
      // Se envía a mano (y no con action=) para que React no reinicie los selects al guardar.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-3"
      noValidate
    >
      <input type="hidden" name="sectionId" value={sectionId} />
      <FormAlert state={state} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-24 py-1 pr-2 font-semibold">Hora</th>
              {WEEKDAYS.map((d) => (
                <th key={d} className="px-1 py-1 font-semibold">
                  {WEEKDAY_LABELS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedule.blocks.map((b) => (
              <tr key={b.number}>
                <td className="whitespace-nowrap py-1 pr-2 tabular-nums text-slate-500">
                  {b.startsAt}–{b.endsAt}
                </td>
                {WEEKDAYS.map((d, i) => (
                  <td key={d} className="px-1 py-1">
                    <select
                      name={`c-${i + 1}-${b.number}`}
                      value={cells[`${i + 1}-${b.number}`] ?? ""}
                      onChange={(e) =>
                        setCells((prev) => ({ ...prev, [`${i + 1}-${b.number}`]: e.target.value }))
                      }
                      aria-label={`${WEEKDAY_LABELS[d]}, ${b.number}.ª hora`}
                      className="input w-full py-1.5 text-sm"
                    >
                      <option value="">—</option>
                      {classes.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
        {pending ? "Guardando…" : "Guardar horario"}
      </button>
    </form>
  );
}
