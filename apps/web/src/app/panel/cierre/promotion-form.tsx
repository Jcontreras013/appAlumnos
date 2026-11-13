"use client";

import { PROMOTION_LABELS, type PromotionDecision, type PromotionRowDto } from "@escolar/shared";
import { useState, useTransition } from "react";
import { type PromotionState, promoteAction } from "./actions";

type Option = { value: string; label: string };

export interface SectionPlan {
  id: string;
  label: string;
  defaultPromotedTo: string;
  defaultRepeatTo: string;
  students: Array<{ studentId: string; name: string; proposal: PromotionDecision; failing: string[] }>;
}

const DECISION_LABEL: Record<PromotionRowDto["decision"], string> = { ...PROMOTION_LABELS, egresa: "Egresa" };

export function PromotionForm({
  toSchoolYearId,
  toSchoolYearName,
  sections,
  nextSections,
}: {
  toSchoolYearId: string;
  toSchoolYearName: string;
  sections: SectionPlan[];
  nextSections: Option[];
}) {
  const [mapping, setMapping] = useState(() =>
    Object.fromEntries(
      sections.map((s) => [s.id, { promoted: s.defaultPromotedTo, repeat: s.defaultRepeatTo }]),
    ),
  );
  const [overrides, setOverrides] = useState<Record<string, "promovido" | "repite">>({});
  const [state, setState] = useState<PromotionState>({});
  const [pending, startTransition] = useTransition();

  const run = (dryRun: boolean) =>
    startTransition(async () => {
      setState(
        await promoteAction({
          toSchoolYearId,
          dryRun,
          sections: sections.map((s) => ({
            fromSectionId: s.id,
            promotedToSectionId: mapping[s.id]?.promoted || null,
            repeatToSectionId: mapping[s.id]?.repeat || null,
          })),
          overrides: Object.entries(overrides).map(([studentId, decision]) => ({ studentId, decision })),
        }),
      );
    });

  const result = state.result;
  const problems = result?.rows.filter((r) => r.problem) ?? [];

  return (
    <div className="space-y-6">
      {sections.map((s) => {
        const counts = { promovido: 0, repite: 0, pendiente: 0 };
        for (const st of s.students) counts[overrides[st.studentId] ?? st.proposal]++;
        return (
          <section key={s.id} className="card space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">{s.label}</h2>
              <p className="text-sm text-slate-600">
                {counts.promovido} promovidos · {counts.repite} repiten
                {counts.pendiente > 0 && (
                  <strong className="text-amber-700"> · {counts.pendiente} con notas pendientes</strong>
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="label">Los promovidos pasan a ({toSchoolYearName})</span>
                <select
                  className="input"
                  value={mapping[s.id]?.promoted ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [s.id]: { ...(m[s.id] ?? { repeat: "" }), promoted: e.target.value },
                    }))
                  }
                >
                  <option value="">Egresan (último grado)</option>
                  {nextSections.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Quienes repiten van a</span>
                <select
                  className="input"
                  value={mapping[s.id]?.repeat ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [s.id]: { ...(m[s.id] ?? { promoted: "" }), repeat: e.target.value },
                    }))
                  }
                >
                  <option value="">Elige…</option>
                  {nextSections.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Ver alumnos y decidir ({s.students.length})
              </summary>
              <ul className="mt-3 divide-y divide-slate-100">
                {s.students.map((st) => (
                  <li
                    key={st.studentId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium text-slate-900">{st.name}</span>
                      {st.failing.length > 0 && (
                        <span className="block text-xs text-red-700">Reprueba: {st.failing.join(", ")}</span>
                      )}
                    </span>
                    <select
                      aria-label={`Decisión para ${st.name}`}
                      className="input w-52 py-1.5"
                      value={overrides[st.studentId] ?? (st.proposal === "pendiente" ? "" : st.proposal)}
                      onChange={(e) =>
                        setOverrides((o) => {
                          const next = { ...o };
                          const v = e.target.value as "promovido" | "repite" | "";
                          if (!v || v === st.proposal) delete next[st.studentId];
                          else next[st.studentId] = v;
                          return next;
                        })
                      }
                    >
                      {st.proposal === "pendiente" && <option value="">Pendiente: decidir</option>}
                      <option value="promovido">Promovido</option>
                      <option value="repite">Repite el grado</option>
                    </select>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        );
      })}

      {state.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {result && (
        <section className="card space-y-3 p-5" aria-live="polite">
          <h2 className="font-semibold text-slate-900">
            {result.dryRun
              ? `Así quedaría ${toSchoolYearName}`
              : `Listo: ${result.enrolled} alumnos matriculados en ${toSchoolYearName}`}
          </h2>
          {problems.length > 0 && (
            <p className="text-sm font-semibold text-amber-800">
              {problems.length} {problems.length === 1 ? "alumno necesita" : "alumnos necesitan"} atención (no
              se matriculan hasta resolverlo).
            </p>
          )}
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((r) => (
                  <tr key={r.studentId}>
                    <td className="py-1.5 pr-3">{r.name}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{r.fromSectionLabel}</td>
                    <td className="py-1.5 pr-3">{DECISION_LABEL[r.decision]}</td>
                    <td className="py-1.5 pr-3">{r.toSectionLabel ?? "—"}</td>
                    <td className="py-1.5 text-xs text-amber-800">{r.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(true)}>
          {pending ? "Revisando…" : "Revisar"}
        </button>
        {result?.dryRun && (
          <button type="button" className="btn-primary" disabled={pending} onClick={() => run(false)}>
            Matricular en {toSchoolYearName}
          </button>
        )}
      </div>
    </div>
  );
}
