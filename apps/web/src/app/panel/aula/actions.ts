"use server";

import {
  classLinkInputSchema,
  classPostInputSchema,
  classQuizInputSchema,
  classSettingsInputSchema,
  classTaskInputSchema,
  type QuizAttemptDto,
  quizQuestionInputSchema,
  taskGradeInputSchema,
  taskSubmissionInputSchema,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError } from "@/lib/forms";

/** Publican en el aula: quien da la clase (o la cubre), la dirección y la coordinación. */
const editor = () => requireRole("docente", "admin", "coordinador");
const classId = (formData: FormData) => z.uuid().parse(formData.get("assignmentId"));
const refresh = (assignmentId: string) => revalidatePath(`/panel/aula/${assignmentId}`);

export async function saveClassSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const values = formValues(formData, ["meetingUrl", "meetingNote"]);
  const parsed = classSettingsInputSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    await academic.saveClassSettings(accessToken, assignmentId, parsed.data);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  refresh(assignmentId);
  return { ok: true, message: parsed.data.meetingUrl ? "Enlace guardado." : "Se quitó el enlace." };
}

/** Publicar un tema o un aviso nuevo, o corregir uno (si viene postId). */
export async function saveClassPostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const postId = String(formData.get("postId") ?? "");
  const values = formValues(formData, ["kind", "title", "body"]);
  const parsed = classPostInputSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    if (postId) await academic.updateClassPost(accessToken, z.uuid().parse(postId), parsed.data);
    else await academic.createClassPost(accessToken, assignmentId, parsed.data);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  refresh(assignmentId);
  return { ok: true, message: postId ? "Cambios guardados." : "Publicado." };
}

export async function deleteClassPostAction(formData: FormData): Promise<void> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  await academic.deleteClassPost(accessToken, z.uuid().parse(formData.get("postId")));
  refresh(assignmentId);
}

/** Subir o bajar un tema en la lista. */
export async function moveTopicAction(formData: FormData): Promise<void> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const ids = z.array(z.uuid()).parse(String(formData.get("order") ?? "").split(","));
  await academic.orderClassTopics(accessToken, assignmentId, ids);
  refresh(assignmentId);
}

export async function addClassLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const postId = z.uuid().parse(formData.get("postId"));
  const values = formValues(formData, ["title", "url"]);
  const parsed = classLinkInputSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    await academic.addClassLink(accessToken, postId, parsed.data);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  refresh(assignmentId);
  return { ok: true };
}

export async function deleteClassMaterialAction(formData: FormData): Promise<void> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  await academic.deleteClassMaterial(accessToken, z.uuid().parse(formData.get("materialId")));
  refresh(assignmentId);
}

// ───────────────────────────── Tareas ─────────────────────────────

const TASK_FIELDS = ["title", "instructions", "dueDate", "dueTime", "points", "periodId"] as const;

/** Publicar una tarea nueva o corregir una (si viene taskId). */
export async function saveTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const taskId = String(formData.get("taskId") ?? "");
  const values = formValues(formData, TASK_FIELDS);
  const allowLate = formData.get("allowLate") === "on";
  const parsed = classTaskInputSchema.safeParse({ ...values, allowLate });
  if (!parsed.success)
    return { ...fromZodError(parsed.error), values: { ...values, allowLate: allowLate ? "on" : "" } };
  let created: string | null = null;
  try {
    if (taskId) await academic.updateClassTask(accessToken, z.uuid().parse(taskId), parsed.data);
    else created = (await academic.createClassTask(accessToken, assignmentId, parsed.data)).id;
  } catch (err) {
    return { ...fromServiceError(err), values: { ...values, allowLate: allowLate ? "on" : "" } };
  }
  refresh(assignmentId);
  if (created) redirect(`/panel/aula/${assignmentId}/tareas/${created}`);
  revalidatePath(`/panel/aula/${assignmentId}/tareas/${taskId}`);
  return { ok: true, message: "Cambios guardados." };
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  await academic.deleteClassTask(accessToken, z.uuid().parse(formData.get("taskId")));
  refresh(assignmentId);
  redirect(`/panel/aula/${assignmentId}`);
}

export interface GradeState extends FormState {
  savedAt?: number;
}

/** Calificar la entrega de un alumno (o ponerle nota aunque haya entregado en papel). */
export async function gradeTaskAction(_prev: GradeState, formData: FormData): Promise<GradeState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const taskId = z.uuid().parse(formData.get("taskId"));
  const studentId = z.uuid().parse(formData.get("studentId"));
  const values = formValues(formData, ["points", "feedback"]);
  const parsed = taskGradeInputSchema.safeParse(values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    await academic.gradeTask(accessToken, taskId, studentId, parsed.data);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  refresh(assignmentId);
  revalidatePath(`/panel/aula/${assignmentId}/tareas/${taskId}`);
  return { ok: true, message: "Guardada.", savedAt: Date.now() };
}

/** El alumno (o su familia): guardar sin entregar, entregar o anular la entrega para corregirla. */
export async function saveSubmissionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("estudiante", "padre");
  const assignmentId = classId(formData);
  const taskId = z.uuid().parse(formData.get("taskId"));
  const alumno = String(formData.get("alumno") ?? "") || undefined;
  const intent = String(formData.get("intent") ?? "guardar");
  const values = formValues(formData, ["text"]);
  const parsed = taskSubmissionInputSchema.safeParse({ text: values.text, turnIn: intent === "entregar" });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    await academic.saveSubmission(accessToken, taskId, parsed.data, alumno);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  refresh(assignmentId);
  revalidatePath(`/panel/aula/${assignmentId}/tareas/${taskId}`);
  return {
    ok: true,
    message:
      intent === "entregar"
        ? "¡Entregada! Tu maestro ya la puede ver."
        : intent === "anular"
          ? "Anulaste la entrega: corrígela y vuelve a entregarla."
          : "Guardada (todavía no la entregas).",
  };
}

/** Quitar un archivo: el maestro, los de la tarea; el alumno, los de su entrega sin entregar. */
export async function deleteTaskFileAction(formData: FormData): Promise<void> {
  const { accessToken } = await requireRole("docente", "admin", "coordinador", "estudiante", "padre");
  const assignmentId = classId(formData);
  const taskId = z.uuid().parse(formData.get("taskId"));
  await academic.deleteTaskFile(accessToken, z.uuid().parse(formData.get("fileId")));
  revalidatePath(`/panel/aula/${assignmentId}/tareas/${taskId}`);
}

// ───────────────────────────── Exámenes ─────────────────────────────

const QUIZ_FIELDS = [
  "title",
  "instructions",
  "opensDate",
  "opensTime",
  "closesDate",
  "closesTime",
  "timeLimitMinutes",
  "points",
  "periodId",
] as const;
const quizPath = (assignmentId: string, quizId: string) =>
  `/panel/aula/${assignmentId}/examenes/${quizId}` as const;

/** Crear un examen (queda en borrador para agregarle preguntas) o corregir sus datos. */
export async function saveQuizAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const quizId = String(formData.get("quizId") ?? "");
  const values = formValues(formData, QUIZ_FIELDS);
  const shuffle = formData.get("shuffle") === "on";
  const parsed = classQuizInputSchema.safeParse({ ...values, shuffle });
  const keep = { ...values, shuffle: shuffle ? "on" : "" };
  if (!parsed.success) return { ...fromZodError(parsed.error), values: keep };
  let created: string | null = null;
  try {
    if (quizId) await academic.updateQuiz(accessToken, z.uuid().parse(quizId), parsed.data);
    else created = (await academic.createQuiz(accessToken, assignmentId, parsed.data)).id;
  } catch (err) {
    return { ...fromServiceError(err), values: keep };
  }
  refresh(assignmentId);
  if (created) redirect(quizPath(assignmentId, created));
  revalidatePath(quizPath(assignmentId, quizId));
  return { ok: true, message: "Cambios guardados." };
}

export async function deleteQuizAction(formData: FormData): Promise<void> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  await academic.deleteQuiz(accessToken, z.uuid().parse(formData.get("quizId")));
  refresh(assignmentId);
  redirect(`/panel/aula/${assignmentId}`);
}

export async function publishQuizAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const quizId = z.uuid().parse(formData.get("quizId"));
  const published = formData.get("published") === "1";
  try {
    await academic.publishQuiz(accessToken, quizId, published);
  } catch (err) {
    return fromServiceError(err);
  }
  refresh(assignmentId);
  revalidatePath(quizPath(assignmentId, quizId));
  return { ok: true, message: published ? "Publicado: los alumnos ya lo ven." : "Volvió a borrador." };
}

/** Agregar o corregir una pregunta. Las opciones llegan como option0…option7 y la correcta como `correct`. */
export async function saveQuestionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const quizId = z.uuid().parse(formData.get("quizId"));
  const questionId = String(formData.get("questionId") ?? "");
  const values = formValues(formData, [
    "kind",
    "prompt",
    "points",
    "correct",
    ...Array.from({ length: 8 }, (_, i) => `option${i}`),
  ]);
  const kind = values.kind;
  const correctRaw = values.correct ?? "";
  const correct =
    kind === "vf"
      ? correctRaw === "true"
        ? true
        : correctRaw === "false"
          ? false
          : null
      : kind === "opcion" && correctRaw !== ""
        ? Number(correctRaw)
        : null;
  // Las opciones vacías se quitan; la correcta se vuelve a contar entre las que quedan.
  const raw = Array.from({ length: 8 }, (_, i) => (values[`option${i}`] ?? "").trim());
  const options = raw.filter((o) => o.length > 0);
  const correctIndex =
    kind === "opcion" && typeof correct === "number" && raw[correct]
      ? raw.slice(0, correct).filter((o) => o.length > 0).length
      : correct;
  const parsed = quizQuestionInputSchema.safeParse({
    kind,
    prompt: values.prompt,
    points: values.points,
    options,
    correct:
      kind === "opcion" ? (typeof correct === "number" && raw[correct] ? correctIndex : null) : correct,
  });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    if (questionId) await academic.updateQuizQuestion(accessToken, z.uuid().parse(questionId), parsed.data);
    else await academic.addQuizQuestion(accessToken, quizId, parsed.data);
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  revalidatePath(quizPath(assignmentId, quizId));
  refresh(assignmentId);
  return { ok: true, message: questionId ? "Pregunta guardada." : "Pregunta agregada." };
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const quizId = z.uuid().parse(formData.get("quizId"));
  await academic.deleteQuizQuestion(accessToken, z.uuid().parse(formData.get("questionId")));
  revalidatePath(quizPath(assignmentId, quizId));
}

/** Puntos de las respuestas abiertas de un alumno (campos q-<id de la pregunta>). */
export async function reviewQuizAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await editor();
  const assignmentId = classId(formData);
  const quizId = z.uuid().parse(formData.get("quizId"));
  const studentId = z.uuid().parse(formData.get("studentId"));
  const points: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("q-") || typeof value !== "string" || value.trim() === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return { error: "Escribe puntos válidos" };
    points[key.slice(2)] = n;
  }
  try {
    await academic.reviewQuiz(accessToken, quizId, studentId, points);
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath(quizPath(assignmentId, quizId));
  refresh(assignmentId);
  return { ok: true, message: "Revisión guardada." };
}

export async function startQuizAction(formData: FormData): Promise<void> {
  const { accessToken } = await requireRole("estudiante", "padre");
  const assignmentId = classId(formData);
  const quizId = z.uuid().parse(formData.get("quizId"));
  const alumno = String(formData.get("alumno") ?? "") || undefined;
  await academic.startQuiz(accessToken, quizId, alumno);
  revalidatePath(quizPath(assignmentId, quizId));
  const target = quizPath(assignmentId, quizId);
  redirect(alumno ? (`${target}?alumno=${alumno}` as typeof target) : target);
}

/** Guardar respuestas mientras resuelve (y entregar con finish). Lo llama el examen en pantalla. */
export async function saveQuizAnswersAction(input: {
  assignmentId: string;
  quizId: string;
  alumno: string | null;
  answers: Record<string, number | boolean | string>;
  finish: boolean;
}): Promise<{ ok: boolean; error?: string; attempt?: QuizAttemptDto }> {
  const { accessToken } = await requireRole("estudiante", "padre");
  const assignmentId = z.uuid().parse(input.assignmentId);
  const quizId = z.uuid().parse(input.quizId);
  try {
    const attempt = await academic.saveQuizAnswers(
      accessToken,
      quizId,
      { answers: input.answers, finish: input.finish },
      input.alumno ?? undefined,
    );
    if (input.finish) {
      revalidatePath(quizPath(assignmentId, quizId));
      refresh(assignmentId);
    }
    return { ok: true, attempt };
  } catch (err) {
    return { ok: false, error: fromServiceError(err).error };
  }
}
