"use client";

import {
  type AssignmentDto,
  type GradeDto,
  type SectionDto,
  type ShiftDto,
  SUBJECT_LANGUAGE_LABELS,
  SUBJECT_LANGUAGES,
  type SubjectDto,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "@escolar/shared";
import { Field, SelectField } from "@/components/form-controls";
import { InlineEditor } from "@/components/inline-editor";
import {
  changeTeacherAction,
  deleteAssignmentAction,
  deleteGradeAction,
  deleteSectionAction,
  deleteShiftAction,
  deleteSubjectAction,
  updateGradeAction,
  updateSectionAction,
  updateShiftAction,
  updateSubjectAction,
} from "./actions";

type Option = { value: string; label: string };

/** Idioma en que se imparte la materia (colegios bilingües): el asistente planifica en ese idioma. */
export const LANGUAGE_OPTIONS: Option[] = SUBJECT_LANGUAGES.map((l) => ({
  value: l,
  label: SUBJECT_LANGUAGE_LABELS[l],
}));

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

export function SectionEditor({ section, shifts = [] }: { section: SectionDto; shifts?: Option[] }) {
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
          {shifts.length > 0 ? (
            <div className="col-span-2 space-y-1">
              <SelectField
                idPrefix={idPrefix}
                name="shiftId"
                label="Jornada"
                options={shifts}
                placeholder="Regular (lunes a viernes)"
                state={state}
                defaultValue={state.values?.shiftId ?? section.shiftId ?? ""}
              />
              <p className="text-xs text-slate-500">
                Al cambiar de jornada, el horario de la sección se vuelve a armar (otros días y otras horas).
              </p>
            </div>
          ) : (
            <input type="hidden" name="shiftId" value={section.shiftId ?? ""} />
          )}
        </div>
      )}
    />
  );
}

export function ShiftEditor({ shift }: { shift: ShiftDto }) {
  return (
    <InlineEditor
      what={`jornada ${shift.name}`}
      id={shift.id}
      update={updateShiftAction}
      remove={deleteShiftAction}
      removeLabel="Eliminar jornada"
      fields={(state, idPrefix) => (
        <div className="space-y-3">
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Jornada"
            required
            state={state}
            defaultValue={state.values?.name ?? shift.name}
          />
          <ClassDaysField selected={shift.classDays} idPrefix={idPrefix} />
          <p className="text-xs text-slate-500">
            Si quitas un día, las clases de ese día se quitan del horario de sus secciones.
          </p>
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
        <div className="grid grid-cols-[1fr_9rem] gap-3">
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Materia"
            required
            state={state}
            defaultValue={state.values?.name ?? subject.name}
          />
          <SelectField
            idPrefix={idPrefix}
            name="language"
            label="Se imparte en"
            options={LANGUAGE_OPTIONS}
            defaultValue={subject.language}
            state={state}
          />
        </div>
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

/** Casillas de los siete días (1 = lunes … 7 = domingo) para los días de clase de una jornada. */
export function ClassDaysField({ selected, idPrefix }: { selected: readonly number[]; idPrefix: string }) {
  return (
    <fieldset>
      <legend className="label">Días de clase</legend>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((day, i) => (
          <label
            key={day}
            htmlFor={`${idPrefix}-dia-${i + 1}`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-sm"
          >
            <input
              id={`${idPrefix}-dia-${i + 1}`}
              type="checkbox"
              name="classDays"
              value={i + 1}
              defaultChecked={selected.includes(i + 1)}
              className="rounded border-slate-300"
            />
            {WEEKDAY_LABELS[day].slice(0, 3)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
