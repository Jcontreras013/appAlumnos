"use server";

import {
  classLinkInputSchema,
  classPostInputSchema,
  classSettingsInputSchema,
  classTaskInputSchema,
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
