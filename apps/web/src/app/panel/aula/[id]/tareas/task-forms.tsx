"use client";

import {
  type ClassTaskDto,
  formatDay,
  type GradingPeriodDto,
  isMeetingSchedule,
  nextClassDay,
  SUBMISSION_FILE_MAX_BYTES,
  type TaskSubmissionDto,
  todayInHonduras,
} from "@escolar/shared";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field, FormAlert, SelectField, TextAreaField } from "@/components/form-controls";
import type { FormState } from "@/lib/form-state";
import { type GradeState, gradeTaskAction, saveSubmissionAction, saveTaskAction } from "../../actions";
import { Toggle, UploadBox } from "../class-editor";

function Submit({ children, pending: pendingText }: { children: React.ReactNode; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary px-3 py-1.5" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Publicar una tarea o corregirla: instrucciones, fecha de entrega y, si lleva nota, su valor y parcial. */
export function TaskForm({
  assignmentId,
  periods,
  currentPeriodId,
  task,
  classDays,
  onDone,
}: {
  assignmentId: string;
  periods: GradingPeriodDto[];
  currentPeriodId: string | null;
  task?: ClassTaskDto;
  /** Días de clase de la sección: en fin de semana, la entrega sugerida es el próximo encuentro. */
  classDays?: number[];
  onDone?: () => void;
}) {
  const id = useId();
  const [state, action] = useActionState<FormState, FormData>(saveTaskAction, {});
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      onDone?.();
    }
  }, [state, onDone]);
  const v = state.values;
  const nextMeeting =
    !task && classDays && isMeetingSchedule(classDays) ? nextClassDay(todayInHonduras(), classDays) : null;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {task && <input type="hidden" name="taskId" value={task.id} />}
      <FormAlert state={state} />
      <Field
        idPrefix={id}
        name="title"
        label="Título"
        placeholder="Ejercicios de fracciones"
        defaultValue={v?.title ?? task?.title ?? ""}
        state={state}
      />
      <TextAreaField
        idPrefix={id}
        name="instructions"
        label="Instrucciones"
        rows={5}
        defaultValue={v?.instructions ?? task?.instructions ?? ""}
        state={state}
        hint="Qué hay que hacer y cómo entregarlo (por ejemplo: «sube una foto clara de tu cuaderno»)."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          idPrefix={id}
          name="dueDate"
          label="Fecha de entrega"
          type="date"
          defaultValue={v?.dueDate ?? task?.dueDate ?? nextMeeting ?? ""}
          state={state}
          hint={nextMeeting ? `Próximo encuentro: ${formatDay(nextMeeting)}` : undefined}
        />
        <Field
          idPrefix={id}
          name="dueTime"
          label="Hora límite"
          type="time"
          defaultValue={v?.dueTime ?? task?.dueTime ?? "23:59"}
          state={state}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="allowLate"
          defaultChecked={v ? v.allowLate === "on" : (task?.allowLate ?? true)}
          className="size-4 rounded border-slate-300"
        />
        Aceptar entregas después de la fecha (quedan marcadas «tarde»)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          idPrefix={id}
          name="points"
          label="Valor en la libreta (puntos)"
          type="number"
          min={0}
          max={100}
          step="0.5"
          placeholder="Sin nota"
          defaultValue={v?.points ?? (task?.points === null || !task ? "" : String(task.points))}
          state={state}
          hint="Déjalo vacío si la tarea no lleva nota."
        />
        <SelectField
          idPrefix={id}
          name="periodId"
          label="Parcial"
          state={state}
          defaultValue={task?.periodId ?? currentPeriodId ?? ""}
          options={periods.map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>
      <PublishChoice idPrefix={id} task={task} state={state} />
      <Submit pending="Guardando…">{task ? "Guardar cambios" : "Guardar tarea"}</Submit>
    </form>
  );
}

/** Cuándo ven la tarea los alumnos: ya, más adelante (fecha y hora) o cuando el maestro decida. */
function PublishChoice({
  idPrefix,
  task,
  state,
}: {
  idPrefix: string;
  task?: ClassTaskDto;
  state: FormState;
}) {
  const v = state.values;
  const initial =
    (v?.publish as "ahora" | "programar" | "borrador" | undefined) ??
    (task?.visibility === "borrador"
      ? "borrador"
      : task?.visibility === "programada"
        ? "programar"
        : "ahora");
  const [mode, setMode] = useState(initial);
  const options = [
    ["ahora", task?.visibility === "publicada" ? "Publicada" : "Publicar ahora"],
    ["programar", "Programar fecha y hora"],
    ["borrador", "Guardar sin publicar"],
  ] as const;
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">¿Cuándo la ven los alumnos?</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="publish"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="size-4 border-slate-300"
            />
            {label}
          </label>
        ))}
      </div>
      {mode === "programar" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            idPrefix={idPrefix}
            name="publishDate"
            label="Fecha de publicación"
            type="date"
            defaultValue={v?.publishDate ?? task?.publishDate ?? ""}
            state={state}
          />
          <Field
            idPrefix={idPrefix}
            name="publishTime"
            label="Hora"
            type="time"
            defaultValue={v?.publishTime ?? task?.publishTime ?? "07:00"}
            state={state}
          />
        </div>
      )}
      {mode === "borrador" && (
        <p className="text-xs text-slate-500">
          Queda guardada solo para ti. Cuando esté lista, edítala y elige «Publicar ahora».
        </p>
      )}
    </fieldset>
  );
}

export function NewTask(props: {
  assignmentId: string;
  periods: GradingPeriodDto[];
  currentPeriodId: string | null;
  classDays?: number[];
}) {
  return (
    <Toggle label="+ Nueva tarea" className="btn-primary">
      {(close) => <TaskForm {...props} onDone={close} />}
    </Toggle>
  );
}

export function EditTask(props: {
  assignmentId: string;
  periods: GradingPeriodDto[];
  currentPeriodId: string | null;
  task: ClassTaskDto;
}) {
  return (
    <Toggle label="Editar tarea" className="btn-secondary px-3 py-1.5">
      {(close) => <TaskForm {...props} onDone={close} />}
    </Toggle>
  );
}

export function TaskAttachmentUpload({ taskId }: { taskId: string }) {
  return (
    <UploadBox url={`/api/aula/tareas/${taskId}/archivos`} label="Adjuntar archivo (guía, hoja de trabajo)" />
  );
}

/** Nota y comentario para la entrega de un alumno. */
export function GradeForm({
  assignmentId,
  taskId,
  submission,
  max,
}: {
  assignmentId: string;
  taskId: string;
  submission: TaskSubmissionDto;
  max: number | null;
}) {
  const id = useId();
  const [state, action] = useActionState<GradeState, FormData>(gradeTaskAction, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="studentId" value={submission.studentId} />
      <Field
        idPrefix={`${id}-nota`}
        name="points"
        label={max === null ? "Nota" : `Nota (de ${max})`}
        type="number"
        min={0}
        max={max ?? 100}
        step="0.5"
        defaultValue={state.values?.points ?? (submission.points === null ? "" : String(submission.points))}
        state={state}
      />
      <Field
        idPrefix={`${id}-comentario`}
        name="feedback"
        label="Comentario (opcional)"
        placeholder="Comentario para el alumno"
        defaultValue={state.values?.feedback ?? submission.feedback ?? ""}
        state={state}
      />
      <div className="flex items-center gap-2">
        <Submit pending="…">Guardar</Submit>
        {state.ok && <span className="text-xs text-brand-700">✓</span>}
      </div>
      {state.error && <p className="text-xs text-red-700 sm:col-span-3">{state.error}</p>}
    </form>
  );
}

function IntentButton({
  intent,
  className,
  children,
}: {
  intent: string;
  className: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} className={className} disabled={pending}>
      {children}
    </button>
  );
}

/** La entrega del alumno: su respuesta, sus archivos y los botones para entregar o anular. */
export function SubmissionForm({
  assignmentId,
  taskId,
  alumno,
  mine,
  canSubmit,
}: {
  assignmentId: string;
  taskId: string;
  alumno: string | null;
  mine: TaskSubmissionDto;
  canSubmit: boolean;
}) {
  const id = useId();
  const [state, action] = useActionState<FormState, FormData>(saveSubmissionAction, {});
  const turnedIn = Boolean(mine.submittedAt);
  const query = alumno ? `?alumno=${alumno}` : "";
  return (
    <div className="space-y-4">
      <FormAlert state={state} />
      {!turnedIn && canSubmit && (
        <UploadBox
          url={`/api/aula/tareas/${taskId}/entrega${query}`}
          max={SUBMISSION_FILE_MAX_BYTES}
          label="Agregar foto o documento"
          capture
        />
      )}
      <form action={action} className="space-y-3" noValidate>
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <input type="hidden" name="taskId" value={taskId} />
        {alumno && <input type="hidden" name="alumno" value={alumno} />}
        <TextAreaField
          idPrefix={id}
          name="text"
          label="Tu respuesta (opcional si subiste archivos)"
          rows={5}
          defaultValue={state.values?.text ?? mine.text}
          state={state}
          readOnly={turnedIn || !canSubmit}
        />
        {canSubmit && (
          <div className="flex flex-wrap gap-2">
            {turnedIn ? (
              <IntentButton intent="anular" className="btn-secondary">
                Anular entrega para corregir
              </IntentButton>
            ) : (
              <>
                <IntentButton intent="entregar" className="btn-primary">
                  Entregar
                </IntentButton>
                <IntentButton intent="guardar" className="btn-secondary">
                  Guardar sin entregar
                </IntentButton>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
