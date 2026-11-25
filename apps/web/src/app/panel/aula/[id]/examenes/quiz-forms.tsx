"use client";

import {
  type ClassQuizDto,
  type GradingPeriodDto,
  QUESTION_KIND_LABELS,
  QUESTION_KINDS,
  type QuestionKind,
  type QuizAttemptDto,
  type QuizQuestionDto,
} from "@escolar/shared";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field, FormAlert, SelectField, TextAreaField } from "@/components/form-controls";
import type { FormState } from "@/lib/form-state";
import {
  publishQuizAction,
  reviewQuizAction,
  saveQuestionAction,
  saveQuizAction,
  saveQuizAnswersAction,
} from "../../actions";
import { Toggle } from "../class-editor";

function Submit({ children, pending: pendingText }: { children: React.ReactNode; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary px-3 py-1.5" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

function useDoneOnOk(state: FormState, onDone?: () => void) {
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      onDone?.();
    }
  }, [state, onDone]);
}

/** Datos del examen: cuándo abre y cierra, el tiempo para resolverlo y su valor en la libreta. */
export function QuizForm({
  assignmentId,
  periods,
  currentPeriodId,
  quiz,
  onDone,
}: {
  assignmentId: string;
  periods: GradingPeriodDto[];
  currentPeriodId: string | null;
  quiz?: ClassQuizDto;
  onDone?: () => void;
}) {
  const id = useId();
  const [state, action] = useActionState<FormState, FormData>(saveQuizAction, {});
  useDoneOnOk(state, onDone);
  const v = state.values;
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {quiz && <input type="hidden" name="quizId" value={quiz.id} />}
      <FormAlert state={state} />
      <Field
        idPrefix={id}
        name="title"
        label="Título"
        placeholder="Prueba corta: fracciones"
        defaultValue={v?.title ?? quiz?.title ?? ""}
        state={state}
      />
      <TextAreaField
        idPrefix={id}
        name="instructions"
        label="Instrucciones (opcional)"
        rows={3}
        defaultValue={v?.instructions ?? quiz?.instructions ?? ""}
        state={state}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field
          idPrefix={id}
          name="opensDate"
          label="Abre el"
          type="date"
          defaultValue={v?.opensDate ?? quiz?.opensDate ?? ""}
          state={state}
        />
        <Field
          idPrefix={id}
          name="opensTime"
          label="a las"
          type="time"
          defaultValue={v?.opensTime ?? quiz?.opensTime ?? "07:00"}
          state={state}
        />
        <Field
          idPrefix={id}
          name="closesDate"
          label="Cierra el"
          type="date"
          defaultValue={v?.closesDate ?? quiz?.closesDate ?? ""}
          state={state}
        />
        <Field
          idPrefix={id}
          name="closesTime"
          label="a las"
          type="time"
          defaultValue={v?.closesTime ?? quiz?.closesTime ?? "23:59"}
          state={state}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          idPrefix={id}
          name="timeLimitMinutes"
          label="Tiempo para resolverlo (minutos)"
          type="number"
          min={1}
          max={600}
          placeholder="Sin límite"
          defaultValue={v?.timeLimitMinutes ?? (quiz?.timeLimitMinutes ? String(quiz.timeLimitMinutes) : "")}
          state={state}
        />
        <Field
          idPrefix={id}
          name="points"
          label="Valor en la libreta (puntos)"
          type="number"
          min={0}
          max={100}
          step="0.5"
          placeholder="Sin nota"
          defaultValue={v?.points ?? (quiz?.points === null || !quiz ? "" : String(quiz.points))}
          state={state}
        />
        <SelectField
          idPrefix={id}
          name="periodId"
          label="Parcial"
          state={state}
          defaultValue={quiz?.periodId ?? currentPeriodId ?? ""}
          options={periods.map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="shuffle"
          defaultChecked={v ? v.shuffle === "on" : (quiz?.shuffle ?? false)}
          className="size-4 rounded border-slate-300"
        />
        Cambiar el orden de las preguntas para cada alumno
      </label>
      <Submit pending="Guardando…">{quiz ? "Guardar cambios" : "Crear examen"}</Submit>
    </form>
  );
}

export function NewQuiz(props: {
  assignmentId: string;
  periods: GradingPeriodDto[];
  currentPeriodId: string | null;
}) {
  return (
    <Toggle label="+ Nuevo examen" className="btn-primary">
      {(close) => <QuizForm {...props} onDone={close} />}
    </Toggle>
  );
}

export function EditQuiz(props: {
  assignmentId: string;
  periods: GradingPeriodDto[];
  currentPeriodId: string | null;
  quiz: ClassQuizDto;
}) {
  return (
    <Toggle label="Editar datos" className="btn-secondary px-3 py-1.5">
      {(close) => <QuizForm {...props} onDone={close} />}
    </Toggle>
  );
}

export function PublishButton({ assignmentId, quiz }: { assignmentId: string; quiz: ClassQuizDto }) {
  const [state, action] = useActionState<FormState, FormData>(publishQuizAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="quizId" value={quiz.id} />
      <input type="hidden" name="published" value={quiz.published ? "0" : "1"} />
      <FormAlert state={state} />
      <Submit pending="…">{quiz.published ? "Volver a borrador" : "Publicar examen"}</Submit>
    </form>
  );
}

/** Una pregunta: el tipo cambia los campos (opciones con la correcta marcada, o verdadero/falso). */
export function QuestionForm({
  assignmentId,
  quizId,
  question,
  onDone,
}: {
  assignmentId: string;
  quizId: string;
  question?: QuizQuestionDto;
  onDone?: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<FormState, FormData>(saveQuestionAction, {});
  const [kind, setKind] = useState<QuestionKind>(
    (state.values?.kind as QuestionKind) ?? question?.kind ?? "opcion",
  );
  const done = useCallback(() => {
    if (!question) {
      form.current?.reset();
      setKind("opcion");
    }
    onDone?.();
  }, [question, onDone]);
  useDoneOnOk(state, done);
  const v = state.values;
  const correct = v?.correct ?? (question?.correct === null || !question ? "" : String(question.correct));
  return (
    <form ref={form} action={action} className="space-y-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="quizId" value={quizId} />
      {question && <input type="hidden" name="questionId" value={question.id} />}
      <FormAlert state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div>
          <label htmlFor={`${id}-kind`} className="label">
            Tipo
          </label>
          <select
            id={`${id}-kind`}
            name="kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as QuestionKind)}
          >
            {QUESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {QUESTION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <Field
          idPrefix={id}
          name="points"
          label="Vale (puntos)"
          type="number"
          min={0}
          step="0.5"
          defaultValue={v?.points ?? (question ? String(question.points) : "1")}
          state={state}
        />
      </div>
      <TextAreaField
        idPrefix={id}
        name="prompt"
        label="Pregunta"
        rows={2}
        defaultValue={v?.prompt ?? question?.prompt ?? ""}
        state={state}
      />
      {kind === "opcion" && (
        <fieldset className="space-y-2">
          <legend className="label">Opciones (marca la correcta)</legend>
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: las seis casillas de opciones son fijas
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct"
                value={String(i)}
                defaultChecked={correct === String(i)}
                aria-label={`La opción ${i + 1} es la correcta`}
                className="size-4"
              />
              <input
                name={`option${i}`}
                className="input"
                placeholder={i < 2 ? `Opción ${i + 1}` : `Opción ${i + 1} (opcional)`}
                defaultValue={v?.[`option${i}`] ?? question?.options[i] ?? ""}
              />
            </div>
          ))}
          {(state.fields?.options || state.fields?.correct) && (
            <p className="text-xs text-red-600">{state.fields?.options ?? state.fields?.correct}</p>
          )}
        </fieldset>
      )}
      {kind === "vf" && (
        <fieldset className="space-y-1">
          <legend className="label">Respuesta correcta</legend>
          <div className="flex gap-4 text-sm">
            {[
              ["true", "Verdadero"],
              ["false", "Falso"],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="correct"
                  value={value}
                  defaultChecked={correct === value}
                  className="size-4"
                />
                {label}
              </label>
            ))}
          </div>
          {state.fields?.correct && <p className="text-xs text-red-600">{state.fields.correct}</p>}
        </fieldset>
      )}
      {kind === "abierta" && (
        <p className="text-xs text-slate-500">
          El alumno escribe su respuesta; tú le pones los puntos al revisar.
        </p>
      )}
      <Submit pending="Guardando…">{question ? "Guardar pregunta" : "Agregar pregunta"}</Submit>
    </form>
  );
}

export function AddQuestion({ assignmentId, quizId }: { assignmentId: string; quizId: string }) {
  return (
    <Toggle label="+ Agregar pregunta" className="btn-primary">
      {() => <QuestionForm assignmentId={assignmentId} quizId={quizId} />}
    </Toggle>
  );
}

export function EditQuestion(props: { assignmentId: string; quizId: string; question: QuizQuestionDto }) {
  return (
    <Toggle label="Editar" className="text-xs font-semibold text-brand-700 hover:underline">
      {(close) => <QuestionForm {...props} onDone={close} />}
    </Toggle>
  );
}

/** Los puntos de las respuestas abiertas de un alumno. */
export function ReviewForm({
  assignmentId,
  quizId,
  attempt,
  questions,
}: {
  assignmentId: string;
  quizId: string;
  attempt: QuizAttemptDto;
  questions: QuizQuestionDto[];
}) {
  const id = useId();
  const [state, action] = useActionState<FormState, FormData>(reviewQuizAction, {});
  return (
    <form action={action} className="space-y-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="quizId" value={quizId} />
      <input type="hidden" name="studentId" value={attempt.studentId} />
      <p className="text-sm font-semibold text-slate-800">Revisión y comentarios para el alumno</p>
      <FormAlert state={state} />
      {questions.map((q, i) => {
        const answer = attempt.answers.find((a) => a.questionId === q.id);
        return (
          <div key={q.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-900">
              {i + 1}. {q.prompt}
            </p>
            {q.kind === "abierta" && (
              <>
                <p className="whitespace-pre-wrap rounded bg-slate-50 px-2 py-1 text-sm text-slate-800">
                  {typeof answer?.answer === "string" && answer.answer ? answer.answer : "(en blanco)"}
                </p>
                <label htmlFor={`${id}-${q.id}`} className="label">
                  Puntos (de {q.points})
                </label>
                <input
                  id={`${id}-${q.id}`}
                  name={`q-${q.id}`}
                  type="number"
                  min={0}
                  max={q.points}
                  step="0.5"
                  className="input w-32"
                  defaultValue={
                    answer?.points === null || answer?.points === undefined ? "" : String(answer.points)
                  }
                />
              </>
            )}
            <label htmlFor={`${id}-c-${q.id}`} className="label">
              Comentario en esta pregunta <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <textarea
              id={`${id}-c-${q.id}`}
              name={`c-${q.id}`}
              rows={2}
              maxLength={500}
              className="input"
              placeholder="Por ejemplo: en qué falló o qué le faltó"
              defaultValue={answer?.comment ?? ""}
            />
          </div>
        );
      })}
      <label htmlFor={`${id}-feedback`} className="label">
        Comentario general <span className="font-normal text-slate-400">(opcional)</span>
      </label>
      <textarea
        id={`${id}-feedback`}
        name="feedback"
        rows={3}
        maxLength={1000}
        className="input"
        placeholder="Lo que quieras decirle sobre todo el examen"
        defaultValue={attempt.feedback ?? ""}
      />
      <Submit pending="Guardando…">Guardar revisión</Submit>
    </form>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * El examen en pantalla: guarda cada respuesta sola (si se va el internet o se cierra la página, lo
 * respondido no se pierde), muestra el tiempo que queda y lo entrega solo cuando se acaba.
 */
export function QuizTaker({
  assignmentId,
  quizId,
  alumno,
  questions,
  initial,
  deadline,
}: {
  assignmentId: string;
  quizId: string;
  alumno: string | null;
  questions: QuizQuestionDto[];
  initial: Record<string, number | boolean | string>;
  deadline: string;
}) {
  const id = useId();
  const router = useRouter();
  const [answers, setAnswers] = useState(initial);
  const [pending, setPending] = useState<Record<string, number | boolean | string>>({});
  const [saving, setSaving] = useState<"listo" | "guardando" | "error">("listo");
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - Date.now());
  const finishing = useRef(false);

  const send = useCallback(
    async (batch: Record<string, number | boolean | string>, finish: boolean) => {
      setSaving("guardando");
      const res = await saveQuizAnswersAction({ assignmentId, quizId, alumno, answers: batch, finish });
      if (!res.ok) {
        setSaving("error");
        setError(res.error ?? "No se pudo guardar");
        return false;
      }
      setSaving("listo");
      setError(null);
      return true;
    },
    [assignmentId, quizId, alumno],
  );

  // Guarda lo que cambió un momento después de la última respuesta.
  useEffect(() => {
    if (!Object.keys(pending).length) return;
    const timer = setTimeout(async () => {
      const batch = pending;
      if (await send(batch, false))
        setPending((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !(k in batch))));
    }, 1200);
    return () => clearTimeout(timer);
  }, [pending, send]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    const ok = await send({ ...pending }, true);
    finishing.current = false;
    if (ok) router.refresh();
  }, [pending, send, router]);

  // El reloj; al llegar a cero, lo entrega solo.
  useEffect(() => {
    const timer = setInterval(() => {
      const ms = new Date(deadline).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) {
        clearInterval(timer);
        void finish();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, finish]);

  const answer = (questionId: string, value: number | boolean | string) => {
    setAnswers((a) => ({ ...a, [questionId]: value }));
    setPending((p) => ({ ...p, [questionId]: value }));
  };
  const seconds = Math.max(0, Math.floor(left / 1000));
  const answered = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "").length;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
        <span className={`font-mono text-lg font-bold ${seconds < 120 ? "text-red-700" : "text-slate-900"}`}>
          {seconds >= 3600 ? `${Math.floor(seconds / 3600)}:` : ""}
          {pad(Math.floor((seconds % 3600) / 60))}:{pad(seconds % 60)}
        </span>
        <span className="text-xs text-slate-500">
          {answered} de {questions.length} respondidas ·{" "}
          {saving === "guardando" ? "guardando…" : saving === "error" ? "sin guardar" : "guardado"}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ol className="space-y-4">
        {questions.map((q, index) => (
          <li key={q.id} className="card space-y-3 p-4">
            <p className="text-sm font-medium text-slate-900">
              <span className="mr-1 text-slate-400">{index + 1}.</span>
              <span className="whitespace-pre-wrap">{q.prompt}</span>
              <span className="ml-2 text-xs font-normal text-slate-500">({q.points} pts)</span>
            </p>
            {q.kind === "opcion" && (
              <div className="space-y-2">
                {q.options.map((option, i) => (
                  <label
                    // biome-ignore lint/suspicious/noArrayIndexKey: las opciones no cambian de orden
                    key={i}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                  >
                    <input
                      type="radio"
                      name={`${id}-${q.id}`}
                      checked={answers[q.id] === i}
                      onChange={() => answer(q.id, i)}
                      className="size-4"
                    />
                    {option}
                  </label>
                ))}
              </div>
            )}
            {q.kind === "vf" && (
              <div className="flex gap-3">
                {[
                  [true, "Verdadero"],
                  [false, "Falso"],
                ].map(([value, label]) => (
                  <label
                    key={String(value)}
                    className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                  >
                    <input
                      type="radio"
                      name={`${id}-${q.id}`}
                      checked={answers[q.id] === value}
                      onChange={() => answer(q.id, value as boolean)}
                      className="size-4"
                    />
                    {label as string}
                  </label>
                ))}
              </div>
            )}
            {q.kind === "abierta" && (
              <textarea
                className="input min-h-28"
                aria-label={`Respuesta a la pregunta ${index + 1}`}
                value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                onChange={(e) => answer(q.id, e.target.value)}
              />
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn-primary w-full sm:w-auto"
        onClick={() => {
          const missing = questions.length - answered;
          const text = missing
            ? `Te faltan ${missing} ${missing === 1 ? "pregunta" : "preguntas"}. ¿Entregar de todos modos?`
            : "¿Entregar el examen? Ya no podrás cambiar las respuestas.";
          if (window.confirm(text)) void finish();
        }}
      >
        Entregar examen
      </button>
    </div>
  );
}
