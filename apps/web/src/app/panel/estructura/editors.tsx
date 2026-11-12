"use client";

import type { AssignmentDto, GradeDto, SectionDto, SubjectDto } from "@escolar/shared";
import { Field, SelectField } from "@/components/form-controls";
import { InlineEditor } from "@/components/inline-editor";
import {
  changeTeacherAction,
  deleteAssignmentAction,
  deleteGradeAction,
  deleteSectionAction,
  deleteSubjectAction,
  updateGradeAction,
  updateSectionAction,
  updateSubjectAction,
} from "./actions";

type Option = { value: string; label: string };

export function GradeEditor({ grade }: { grade: GradeDto }) {
  return (
    <InlineEditor
      what={grade.name}
      id={grade.id}
      update={updateGradeAction}
      remove={deleteGradeAction}
      removeLabel="Eliminar grado"
      fields={(state, idPrefix) => (
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Grado"
            required
            state={state}
            defaultValue={state.values?.name ?? grade.name}
          />
          <Field
            idPrefix={idPrefix}
            name="sortOrder"
            label="Orden"
            type="number"
            min={0}
            state={state}
            defaultValue={state.values?.sortOrder ?? String(grade.sortOrder)}
          />
        </div>
      )}
    />
  );
}

export function SectionEditor({ section }: { section: SectionDto }) {
  return (
    <InlineEditor
      what={`sección ${section.label}`}
      id={section.id}
      update={updateSectionAction}
      remove={deleteSectionAction}
      removeLabel="Eliminar sección"
      fields={(state, idPrefix) => (
        <div className="grid grid-cols-2 gap-3">
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Sección"
            required
            state={state}
            defaultValue={state.values?.name ?? section.name}
          />
          <Field
            idPrefix={idPrefix}
            name="capacity"
            label="Cupo"
            type="number"
            min={1}
            placeholder="Sin límite"
            state={state}
            defaultValue={
              state.values?.capacity ?? (section.capacity === null ? "" : String(section.capacity))
            }
          />
        </div>
      )}
    />
  );
}

export function SubjectEditor({ subject }: { subject: SubjectDto }) {
  return (
    <InlineEditor
      what={subject.name}
      id={subject.id}
      update={updateSubjectAction}
      remove={deleteSubjectAction}
      removeLabel="Eliminar materia"
      fields={(state, idPrefix) => (
        <Field
          idPrefix={idPrefix}
          name="name"
          label="Materia"
          required
          state={state}
          defaultValue={state.values?.name ?? subject.name}
        />
      )}
    />
  );
}

/** Cambiar quién da la clase (sus notas y planificaciones se quedan) o quitarla si no tiene trabajo. */
export function AssignmentEditor({
  assignment,
  teachers,
}: {
  assignment: AssignmentDto;
  teachers: Option[];
}) {
  return (
    <InlineEditor
      what={`${assignment.subjectName} de ${assignment.sectionLabel}`}
      trigger="Cambiar docente"
      id={assignment.id}
      update={changeTeacherAction}
      remove={deleteAssignmentAction}
      removeLabel="Quitar esta clase"
      fields={(state, idPrefix) => (
        <>
          <SelectField
            idPrefix={idPrefix}
            name="teacherUserId"
            label="Docente"
            options={teachers}
            defaultValue={assignment.teacherUserId}
            state={state}
          />
          <p className="text-xs text-slate-500">
            Las actividades, notas y planificaciones de la clase pasan a la persona nueva.
          </p>
        </>
      )}
    />
  );
}
