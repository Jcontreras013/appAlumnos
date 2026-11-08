"use client";

import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import {
  createAssignmentAction,
  createGradeAction,
  createSectionAction,
  createSubjectAction,
  createYearAction,
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
