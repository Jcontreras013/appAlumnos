"use client";

import type { DisciplineKind, DisciplineStudentOption } from "@escolar/shared";
import { useActionState } from "react";
import { DisciplineFields } from "@/components/discipline-fields";
import { FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { addDisciplineAction } from "./actions";

/** Registrar desde la página de disciplina: primero se elige al alumno (agrupados por sección). */
export function DisciplineForm({
  students,
  kinds,
}: {
  students: DisciplineStudentOption[];
  kinds: DisciplineKind[];
}) {
  const [state, action] = useActionState(addDisciplineAction, initialFormState);
  const bySection = new Map<string, DisciplineStudentOption[]>();
  for (const s of students) bySection.set(s.sectionLabel, [...(bySection.get(s.sectionLabel) ?? []), s]);
  const studentError = state.fields?.id;
  const chosen = state.ok ? "" : (state.values?.id ?? "");
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ? state.message : "disciplina"}>
      <FormAlert state={state} />
      <div>
        <label htmlFor="disciplina-id" className="label">
          Alumno
        </label>
        <select
          key={chosen || "vacio"}
          id="disciplina-id"
          name="id"
          className="input"
          defaultValue={chosen}
          aria-invalid={Boolean(studentError)}
        >
          <option value="">Elige al alumno…</option>
          {[...bySection].map(([section, list]) => (
            <optgroup key={section} label={section}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {studentError && <p className="mt-1 text-xs text-red-600">{studentError}</p>}
      </div>
      <DisciplineFields state={state} kinds={kinds} />
      <SubmitButton pendingText="Guardando…">Registrar</SubmitButton>
    </form>
  );
}
