"use client";

import { FINAL_STATUS_LABELS, type FinalStatus, matchesSearch } from "@escolar/shared";
import { useActionState, useState } from "react";
import { FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { saveRecoveriesAction } from "./actions";

export interface FinalRow {
  studentId: string;
  name: string;
  periods: Array<number | null>;
  average: number | null;
  recovery: number | null;
  status: FinalStatus;
}

const STYLES: Record<FinalStatus, string> = {
  aprobada: "bg-brand-50 text-brand-800",
  aprobada_recuperacion: "bg-sky-50 text-sky-800",
  reprobada: "bg-red-100 text-red-800",
  incompleta: "bg-slate-100 text-slate-600",
};

/** Notas finales de una clase con la casilla de recuperación para quien no alcanzó la nota mínima. */
export function RecoveryForm({
  assignmentId,
  periods,
  rows,
  passingGrade,
  canEdit,
}: {
  assignmentId: string;
  periods: string[];
  rows: FinalRow[];
  passingGrade: number;
  canEdit: boolean;
}) {
  const [state, action] = useActionState(saveRecoveriesAction, initialFormState);
  const recoverable = rows.filter((r) => r.average !== null && r.average < passingGrade);
  const [query, setQuery] = useState("");
  const [onlyRecovery, setOnlyRecovery] = useState(false);
  // Las filas que no coinciden se ocultan pero siguen en el formulario: su recuperación no se pierde.
  const shows = (r: FinalRow) =>
    (!onlyRecovery || (r.average !== null && r.average < passingGrade)) && matchesSearch(r.name, query);
  const shown = rows.filter(shows).length;
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormAlert state={state} />
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={(e) => e.target.select()}
            // Enter en el buscador no debe enviar el formulario de recuperación.
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder="Buscar alumno"
            aria-label="Buscar alumno"
            autoComplete="off"
            className="input min-w-56 flex-1 sm:max-w-sm"
          />
          {[
            { value: false, label: `Todos (${rows.length})` },
            { value: true, label: `Deben recuperación (${recoverable.length})` },
          ].map((o) => (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={onlyRecovery === o.value}
              onClick={() => setOnlyRecovery(o.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                onlyRecovery === o.value
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {o.label}
            </button>
          ))}
          {(query.trim() || onlyRecovery) && (
            <span className="text-xs text-slate-500">
              {shown} de {rows.length}
            </span>
          )}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Alumno</th>
              {periods.map((p) => (
                <th key={p} className="px-2 py-2 text-center font-semibold">
                  {p.replace(" Parcial", "")}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold">Promedio</th>
              <th className="px-2 py-2 font-semibold">Recuperación</th>
              <th className="px-4 py-2 font-semibold">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const canRecover = r.average !== null && r.average < passingGrade;
              return (
                <tr key={r.studentId} className={shows(r) ? undefined : "hidden"}>
                  <td className="px-4 py-2 font-medium text-slate-900">{r.name}</td>
                  {r.periods.map((g, i) => (
                    <td key={periods[i]} className="px-2 py-2 text-center tabular-nums">
                      {g ?? "—"}
                    </td>
                  ))}
                  <td
                    className={`px-2 py-2 text-center font-semibold tabular-nums ${
                      r.average !== null && r.average < passingGrade ? "text-red-700" : "text-slate-900"
                    }`}
                  >
                    {r.average ?? "—"}
                  </td>
                  <td className="px-2 py-2">
                    {canRecover && canEdit ? (
                      <input
                        name={`r-${r.studentId}`}
                        defaultValue={r.recovery ?? ""}
                        inputMode="decimal"
                        aria-label={`Recuperación de ${r.name}`}
                        className="input w-20 py-1 text-center"
                      />
                    ) : (
                      <span className="tabular-nums text-slate-500">{r.recovery ?? ""}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STYLES[r.status]}`}
                    >
                      {FINAL_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 0 && shown === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">
            {onlyRecovery && !query.trim()
              ? "Nadie debe recuperación en esta clase."
              : "Ningún alumno coincide con la búsqueda."}
          </p>
        )}
      </div>
      {canEdit && recoverable.length > 0 && (
        <SubmitButton pendingText="Guardando…">Guardar recuperación</SubmitButton>
      )}
    </form>
  );
}
