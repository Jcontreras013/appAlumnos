"use server";

import { classLinkInputSchema, classPostInputSchema, classSettingsInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
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
