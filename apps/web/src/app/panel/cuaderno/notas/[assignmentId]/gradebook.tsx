"use client";

import {
  type ActivityDto,
  activityInputSchema,
  formatDay,
  type GradebookDto,
  periodGrade,
  RISK_RULES,
} from "@escolar/shared";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { SyncStatus } from "@/components/offline";
import { localToday, newId } from "@/lib/offline/ids";
import type { SyncOp } from "@/lib/offline/outbox";
import { pendingFor, record, startSync } from "@/lib/offline/sync";

type Scores = Record<string, Record<string, number | null>>;

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
const cellKey = (studentId: string, activityId: string) => `${studentId}:${activityId}`;
const clamp = (date: string, min: string, max: string) => (date < min ? min : date > max ? max : date);

/** Aplica sobre los datos del servidor los cambios que siguen guardados en el dispositivo. */
function applyOps(book: GradebookDto, ops: SyncOp[]) {
  let activities = [...book.activities];
  const scores: Scores = Object.fromEntries(book.students.map((s) => [s.studentId, { ...s.scores }]));
  for (const op of ops) {
    if (op.kind === "activity.put") {
      const { input } = op;
      if (input.assignmentId !== book.assignment.id) continue;
      activities = activities.filter((a) => a.id !== input.id);
      if (input.periodId === book.period.id) {
        activities.push({ id: input.id, name: input.name, maxPoints: input.maxPoints, date: input.date });
      }
    } else if (op.kind === "activity.delete") {
      activities = activities.filter((a) => a.id !== op.id);
    } else if (op.kind === "scores.put") {
      for (const e of op.input.entries) {
        const own = scores[e.studentId];
        if (own) own[op.input.activityId] = e.points;
      }
    }
  }
  return { activities: sortActivities(activities), scores };
}

const sortActivities = (list: ActivityDto[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));

export function Gradebook({ owner, book }: { owner: string; book: GradebookDto }) {
  const scope = `notas:${book.assignment.id}`;
  const initial = useMemo(() => applyOps(book, []), [book]);
  const [activities, setActivities] = useState(initial.activities);
  const [scores, setScores] = useState<Scores>(initial.scores);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ActivityDto | "nueva" | null>(null);

  useEffect(() => {
    startSync(owner);
    let alive = true;
    pendingFor(owner, scope)
      .then((records) => {
        if (!alive || records.length === 0) return;
        const applied = applyOps(
          book,
          records.map((r) => r.op),
        );
        setActivities(applied.activities);
        setScores(applied.scores);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [owner, scope, book]);

  const possible = activities.reduce((acc, a) => acc + a.maxPoints, 0);
  const rows = book.students.map((s) => {
    const own = scores[s.studentId] ?? {};
    const result = periodGrade(activities, own);
    const atRisk =
      result.projected !== null &&
      result.possible >= RISK_RULES.minPointsToProject &&
      result.projected < book.passingGrade;
    return { ...s, ...result, scores: own, atRisk };
  });
  const missing = rows.reduce((acc, r) => acc + r.missing, 0);
  const atRisk = rows.filter((r) => r.atRisk).length;
  const canEdit = book.canEdit;

  function commitScore(studentId: string, activity: ActivityDto, text: string) {
    const key = cellKey(studentId, activity.id);
    const clean = text.trim().replace(",", ".");
    const points = clean === "" ? null : Math.round(Number(clean) * 100) / 100;
    const nextErrors = { ...errors };
    delete nextErrors[key];
    if (points !== null && (!Number.isFinite(points) || points < 0 || points > activity.maxPoints)) {
      setErrors({ ...nextErrors, [key]: `Escribe un número de 0 a ${activity.maxPoints}` });
      return;
    }
    setErrors(nextErrors);
    setDrafts(({ [key]: _, ...rest }) => rest);
    if ((scores[studentId]?.[activity.id] ?? null) === points) return;
    setScores((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [activity.id]: points } }));
    void record(owner, [
      {
        key: `score:${activity.id}:${studentId}`,
        scope,
        op: { kind: "scores.put", input: { activityId: activity.id, entries: [{ studentId, points }] } },
      },
    ]);
  }

  function removeActivity(activity: ActivityDto) {
    if (!window.confirm(`¿Borrar "${activity.name}" y todas sus notas?`)) return;
    setActivities((prev) => prev.filter((a) => a.id !== activity.id));
    setScores((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([studentId, own]) => {
          const { [activity.id]: _, ...rest } = own;
          return [studentId, rest];
        }),
      ),
    );
    setEditing(null);
    void record(
      owner,
      [{ key: `act:${activity.id}`, scope, op: { kind: "activity.delete", id: activity.id } }],
      [`score:${activity.id}:`],
    );
  }

  function focusBelow(row: number, col: number) {
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${row + 1}:${col}"]`);
    next?.focus();
    next?.select();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SyncStatus />
        {canEdit && (
          <button type="button" className="btn-primary" onClick={() => setEditing("nueva")}>
            Nueva actividad
          </button>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Puntos repartidos" value={`${possible} / 100`}>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full ${possible >= 100 ? "bg-brand-500" : "bg-amber-400"}`}
              style={{ width: `${Math.min(possible, 100)}%` }}
            />
          </div>
        </Summary>
        <Summary label="Notas sin poner" value={missing} tone={missing > 0 ? "warn" : "ok"} />
        <Summary label="Van reprobando" value={atRisk} tone={atRisk > 0 ? "alert" : "ok"} />
        <Summary label="Cierre de notas" value={formatDay(book.period.closesOn)} />
      </section>

      {editing && (
        <ActivityForm
          key={editing === "nueva" ? "nueva" : editing.id}
          book={book}
          activity={editing === "nueva" ? null : editing}
          used={possible - (editing === "nueva" ? 0 : editing.maxPoints)}
          highestScore={editing === "nueva" ? 0 : Math.max(0, ...rows.map((r) => r.scores[editing.id] ?? 0))}
          onCancel={() => setEditing(null)}
          onDelete={editing === "nueva" ? undefined : () => removeActivity(editing)}
          onSave={(activity) => {
            setActivities((prev) => sortActivities([...prev.filter((a) => a.id !== activity.id), activity]));
            setEditing(null);
            void record(owner, [
              {
                key: `act:${activity.id}`,
                scope,
                op: {
                  kind: "activity.put",
                  input: { ...activity, assignmentId: book.assignment.id, periodId: book.period.id },
                },
              },
            ]);
          }}
        />
      )}

      <section className="card overflow-hidden">
        {book.students.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Esta sección todavía no tiene alumnos matriculados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-48 border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold uppercase tracking-wide">
                    Alumno
                  </th>
                  {activities.map((a) => (
                    <th
                      key={a.id}
                      className="min-w-24 border-b border-slate-200 bg-slate-50 px-2 py-2 align-bottom"
                    >
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing(a)}
                          className="block w-full text-left hover:text-brand-700"
                          title="Editar actividad"
                        >
                          <ActivityHead activity={a} />
                        </button>
                      ) : (
                        <ActivityHead activity={a} />
                      )}
                    </th>
                  ))}
                  <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold uppercase tracking-wide">
                    Acumulado
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold uppercase tracking-wide">
                    Nota
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, row) => (
                  <tr key={r.studentId} className={r.atRisk ? "bg-red-50/50" : undefined}>
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2">
                      <span className="font-medium text-slate-900">{r.name}</span>
                      {r.atRisk && (
                        <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                          En riesgo
                        </span>
                      )}
                    </td>
                    {activities.map((a, col) => {
                      const key = cellKey(r.studentId, a.id);
                      const value = r.scores[a.id];
                      if (!canEdit) {
                        return (
                          <td key={a.id} className="border-b border-slate-100 px-2 py-2 tabular-nums">
                            {value ?? <span className="text-slate-300">—</span>}
                          </td>
                        );
                      }
                      return (
                        <td key={a.id} className="border-b border-slate-100 px-1 py-1">
                          <input
                            data-cell={`${row}:${col}`}
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={`${r.name}, ${a.name} (de ${a.maxPoints})`}
                            aria-invalid={Boolean(errors[key])}
                            title={errors[key]}
                            value={drafts[key] ?? fmt(value)}
                            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                            onBlur={(e) => commitScore(r.studentId, a, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitScore(r.studentId, a, e.currentTarget.value);
                                focusBelow(row, col);
                              } else if (e.key === "Escape") {
                                setDrafts(({ [key]: _, ...rest }) => rest);
                              }
                            }}
                            className={`w-20 rounded-md border px-2 py-1.5 text-right tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${
                              errors[key] ? "border-red-400 bg-red-50" : "border-slate-200"
                            }`}
                          />
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.points} <span className="text-xs text-slate-400">de {r.possible}</span>
                    </td>
                    <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2 text-right tabular-nums">
                      {r.grade !== null ? (
                        <strong className={r.grade < book.passingGrade ? "text-red-700" : "text-slate-900"}>
                          {r.grade}
                        </strong>
                      ) : r.projected !== null ? (
                        <span
                          className={r.atRisk ? "text-red-700" : "text-slate-500"}
                          title="Proyección en base 100 con lo evaluado hasta ahora"
                        >
                          ≈ {r.projected}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {activities.length === 0 && book.students.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-4 text-sm text-slate-500">
            {canEdit
              ? "Agrega la primera actividad del parcial (tarea, prueba, trabajo, examen…) y reparte los 100 puntos."
              : "El maestro todavía no ha registrado actividades en este parcial."}
          </p>
        )}
      </section>
      <p className="text-xs text-slate-500">
        Nota mínima para aprobar: {book.passingGrade}. «≈» es la proyección en base 100 con lo evaluado hasta
        ahora; la nota del parcial queda cuando se reparten los 100 puntos.
        {canEdit && " Las notas se guardan solas al salir de cada casilla (Enter pasa al siguiente alumno)."}
      </p>
    </div>
  );
}

function ActivityHead({ activity }: { activity: ActivityDto }) {
  return (
    <>
      <span className="block truncate font-semibold normal-case text-slate-700" title={activity.name}>
        {activity.name}
      </span>
      <span className="block font-normal tabular-nums">
        {activity.maxPoints} pts · {formatDay(activity.date).replace(/ de \d{4}$/, "")}
      </span>
    </>
  );
}

function Summary({
  label,
  value,
  tone = "neutral",
  children,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "ok" | "warn" | "alert";
  children?: React.ReactNode;
}) {
  const color = {
    neutral: "text-slate-900",
    ok: "text-brand-700",
    warn: "text-amber-700",
    alert: "text-red-700",
  }[tone];
  return (
    <div className="card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {children}
    </div>
  );
}

function ActivityForm({
  book,
  activity,
  used,
  highestScore,
  onSave,
  onCancel,
  onDelete,
}: {
  book: GradebookDto;
  activity: ActivityDto | null;
  /** Puntos que ya reparten las demás actividades. */
  used: number;
  highestScore: number;
  onSave: (activity: ActivityDto) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const available = 100 - used;
  const defaultDate = clamp(localToday(), book.period.startsOn, book.period.closesOn);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      id: activity?.id ?? newId(),
      assignmentId: book.assignment.id,
      periodId: book.period.id,
      name: String(form.get("name") ?? ""),
      maxPoints: String(form.get("maxPoints") ?? "").replace(",", "."),
      date: String(form.get("date") ?? ""),
    };
    const parsed = activityInputSchema.safeParse(input);
    const next: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    } else {
      if (parsed.data.maxPoints > available) {
        next.maxPoints =
          available > 0
            ? `Solo quedan ${available} puntos por repartir en este parcial`
            : "Ya se repartieron los 100 puntos del parcial";
      } else if (parsed.data.maxPoints < highestScore) {
        next.maxPoints = `Hay notas de ${highestScore}; el valor no puede ser menor`;
      }
    }
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;
    const { id, name, maxPoints, date } = parsed.data;
    onSave({ id, name, maxPoints, date });
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-4" noValidate aria-label="Actividad">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{activity ? "Editar actividad" : "Nueva actividad"}</h2>
        <span className="text-xs text-slate-500">
          {available > 0 ? `Quedan ${available} de 100 puntos` : "Parcial completo (100 puntos)"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_11rem]">
        <FormInput
          label="Actividad"
          name="name"
          defaultValue={activity?.name}
          placeholder="Tarea 1"
          error={errors.name}
        />
        <FormInput
          label="Vale (puntos)"
          name="maxPoints"
          inputMode="decimal"
          defaultValue={
            activity ? String(activity.maxPoints) : available > 0 ? String(Math.min(available, 10)) : ""
          }
          error={errors.maxPoints}
        />
        <FormInput
          label="Fecha"
          name="date"
          type="date"
          defaultValue={activity?.date ?? defaultDate}
          min={book.period.startsOn}
          max={book.period.closesOn}
          error={errors.date}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-primary">
          {activity ? "Guardar cambios" : "Agregar actividad"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        {onDelete && (
          <button
            type="button"
            className="ml-auto text-sm font-semibold text-red-700 hover:underline"
            onClick={onDelete}
          >
            Borrar actividad
          </button>
        )}
      </div>
    </form>
  );
}

function FormInput({
  label,
  name,
  error,
  ...input
}: { label: string; name: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `actividad-${name}`;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} name={name} className="input" aria-invalid={Boolean(error)} {...input} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
