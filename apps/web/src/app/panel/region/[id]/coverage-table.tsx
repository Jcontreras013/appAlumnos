"use client";

import { COVERAGE_LABELS, type CoverageRowDto, formatDay, LEAVE_TYPE_LABELS } from "@escolar/shared";
import { useState } from "react";

const STATUS_STYLES = {
  normal: "bg-slate-100 text-slate-700",
  cubierta: "bg-amber-50 text-amber-800",
  sin_cubrir: "bg-red-100 text-red-800",
} as const;
const STATUS_ORDER = ["sin_cubrir", "cubierta", "normal"] as const;
const ALL = "todas";

/**
 * ¿Quién da cada clase? Una sección a la vez, elegida en la barra de arriba. Abre en la primera
 * sección con clases sin maestro, para que el problema se vea sin buscarlo.
 */
export function CoverageTable({ rows }: { rows: CoverageRowDto[] }) {
  const sections: Array<{ id: string; label: string; classes: number; uncovered: number }> = [];
  for (const r of rows) {
    const found = sections.find((s) => s.id === r.assignment.sectionId);
    const entry = found ?? {
      id: r.assignment.sectionId,
      label: r.assignment.sectionLabel,
      classes: 0,
      uncovered: 0,
    };
    if (!found) sections.push(entry);
    entry.classes += 1;
    if (r.status === "sin_cubrir") entry.uncovered += 1;
  }
  const [selected, setSelected] = useState(
    () => sections.find((s) => s.uncovered > 0)?.id ?? sections.at(0)?.id ?? ALL,
  );

  if (rows.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-slate-500">
        El centro todavía no asignó maestros a sus clases.
      </p>
    );
  }

  const shown = rows
    .filter((r) => selected === ALL || r.assignment.sectionId === selected)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const uncoveredTotal = sections.reduce((acc, s) => acc + s.uncovered, 0);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-56 flex-1 sm:flex-none">
          <label htmlFor="cobertura-seccion" className="label">
            Sección
          </label>
          <select
            id="cobertura-seccion"
            className="input"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value={ALL}>
              Todas las secciones ({rows.length} clases
              {uncoveredTotal ? ` · ${uncoveredTotal} sin maestro` : ""})
            </option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.classes} {s.classes === 1 ? "clase" : "clases"}
                {s.uncovered ? ` · ${s.uncovered} sin maestro` : ""})
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-sm text-slate-500">
          {shown.length} {shown.length === 1 ? "clase" : "clases"}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {selected === ALL && <th className="px-4 py-2 font-semibold">Sección</th>}
              <th className="px-4 py-2 font-semibold">Materia</th>
              <th className="px-4 py-2 font-semibold">Maestro titular</th>
              <th className="px-4 py-2 font-semibold">Situación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.assignment.id}>
                {selected === ALL && (
                  <td className="whitespace-nowrap px-4 py-2">{r.assignment.sectionLabel}</td>
                )}
                <td className="px-4 py-2">{r.assignment.subjectName}</td>
                <td className="px-4 py-2">{r.assignment.teacherName}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status]}`}
                  >
                    {COVERAGE_LABELS[r.status]}
                  </span>
                  {r.leave && (
                    <p className="mt-1 text-xs text-slate-500">
                      {LEAVE_TYPE_LABELS[r.leave.type]} hasta el {formatDay(r.leave.endsOn)}
                      {r.substitute && ` · cubre ${r.substitute.substituteName}`}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
