"use client";

import { defaultPeriods, type GradingPeriodDto, PERIOD_NAMES } from "@escolar/shared";
import { useActionState, useState } from "react";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import {
  createAssignmentAction,
  createGradeAction,
  createSectionAction,
  createSubjectAction,
  createYearAction,
  setPassingGradeAction,
  updatePeriodsAction,
} from "./actions";

type Option = { value: string; label: string };

export function YearForm() {
  const [state, action] = useActionState(createYearAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field name="name" label="Nombre" placeholder="2027" required state={state} />
      <div className="grid grid-cols-2 gap-3">
        <Field name="startsOn" label="Inicia" type="date" required state={state} />
        <Field name="endsOn" label="Termina" type="date" required state={state} />
      </div>
      <SubmitButton pendingText="Creando…">Crear año lectivo</SubmitButton>
    </form>
  );
}

export function GradeForm() {
  const [state, action] = useActionState(createGradeAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field name="name" label="Grado" placeholder="Primer grado" required state={state} />
        <Field name="sortOrder" label="Orden" type="number" min={0} placeholder="1" state={state} />
      </div>
      <SubmitButton pendingText="Creando…">Agregar grado</SubmitButton>
    </form>
  );
}

export function SectionForm({ schoolYearId, grades }: { schoolYearId: string; grades: Option[] }) {
  const [state, action] = useActionState(createSectionAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="schoolYearId" value={schoolYearId} />
      <SelectField name="gradeId" label="Grado" options={grades} placeholder="Elige…" state={state} />
      <div className="grid grid-cols-2 gap-3">
        <Field name="name" label="Sección" placeholder="A" required state={state} />
        <Field name="capacity" label="Cupo" type="number" min={1} placeholder="Sin límite" state={state} />
      </div>
      <SubmitButton pendingText="Creando…">Agregar sección</SubmitButton>
    </form>
  );
}

export function SubjectForm() {
  const [state, action] = useActionState(createSubjectAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field name="name" label="Materia" placeholder="Matemáticas" required state={state} />
      <SubmitButton pendingText="Creando…">Agregar materia</SubmitButton>
    </form>
  );
}

export function AssignmentForm({
  sections,
  subjects,
  teachers,
}: {
  sections: Option[];
  subjects: Option[];
  teachers: Option[];
}) {
  const [state, action] = useActionState(createAssignmentAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField name="sectionId" label="Sección" options={sections} placeholder="Elige…" state={state} />
      <SelectField name="subjectId" label="Materia" options={subjects} placeholder="Elige…" state={state} />
      <SelectField
        name="teacherUserId"
        label="Docente"
        options={teachers}
        placeholder={teachers.length ? "Elige…" : "Primero crea usuarios con rol Docente"}
        state={state}
      />
      <SubmitButton pendingText="Asignando…">Asignar docente</SubmitButton>
    </form>
  );
}

type PeriodRow = Pick<GradingPeriodDto, "name" | "startsOn" | "endsOn" | "closesOn">;

/** Parciales del año: cuántos son y sus fechas (inicio, fin y último día para tener las notas). */
export function PeriodsForm({
  periods,
  year,
}: {
  periods: GradingPeriodDto[];
  year: { startsOn: string; endsOn: string };
}) {
  const [state, action] = useActionState(updatePeriodsAction, initialFormState);
  const [rows, setRows] = useState<PeriodRow[]>(() =>
    periods.map(({ name, startsOn, endsOn, closesOn }) => ({ name, startsOn, endsOn, closesOn })),
  );
  const update = (i: number, patch: Partial<PeriodRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const redistribute = (count: number) => setRows(defaultPeriods(year.startsOn, year.endsOn, count));

  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2 font-semibold">Parcial</th>
              <th className="py-1 pr-2 font-semibold">Inicia</th>
              <th className="py-1 pr-2 font-semibold">Termina</th>
              <th className="py-1 font-semibold">Cierre de notas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={PERIOD_NAMES[i] ?? i}>
                {(["name", "startsOn", "endsOn", "closesOn"] as const).map((key) => (
                  <td key={key} className="py-1 pr-2">
                    <input
                      name={key}
                      type={key === "name" ? "text" : "date"}
                      value={r[key]}
                      onChange={(e) => update(i, { [key]: e.target.value })}
                      aria-label={`${r.name || `Parcial ${i + 1}`}: ${
                        { name: "nombre", startsOn: "inicio", endsOn: "fin", closesOn: "cierre de notas" }[
                          key
                        ]
                      }`}
                      className={`input py-1.5 ${key === "name" ? "min-w-28" : "min-w-36"}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Guardando…">Guardar parciales</SubmitButton>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          Repartir el año en
          <select
            className="input w-20 py-1.5"
            value={rows.length}
            onChange={(e) => redistribute(Number(e.target.value))}
            aria-label="Cantidad de parciales"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          parciales
        </label>
      </div>
      <p className="text-xs text-slate-500">
        El cierre de notas es la fecha límite para tener todas las notas del parcial antes de pasarlas al
        SACE. Un parcial que ya tiene notas no se puede quitar.
      </p>
    </form>
  );
}

export function PassingGradeForm({ passingGrade }: { passingGrade: number }) {
  const [state, action] = useActionState(setPassingGradeAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field
        name="passingGrade"
        label="Nota mínima para aprobar"
        type="number"
        min={1}
        max={100}
        defaultValue={String(passingGrade)}
        hint="En Honduras suele ser 70. Se usa para marcar a los alumnos que van reprobando."
        state={state}
      />
      <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
    </form>
  );
}
