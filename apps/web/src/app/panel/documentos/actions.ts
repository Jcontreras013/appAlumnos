"use server";

import {
  DOCUMENT_TEMPLATES,
  type DocumentDto,
  documentTemplate,
  type SaveDocumentInput,
  saveDocumentInputSchema,
  todayInHonduras,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

const staff = () => requireRole("admin", "coordinador", "secretaria", "docente");

/** Crea un documento desde una plantilla (con el nombre del centro, la fecha y quien lo escribe) y lo abre. */
export async function createDocumentAction(formData: FormData) {
  const session = await staff();
  const template = z.enum(DOCUMENT_TEMPLATES).parse(formData.get("template"));
  const { title, content } = documentTemplate(template, {
    schoolName: session.school?.name ?? "",
    date: todayInHonduras(),
    authorName: session.user.name,
  });
  const doc = await academic.createDocument(session.accessToken, { title, template, content });
  revalidatePath("/panel/documentos");
  redirect(`/panel/documentos/${doc.id}`);
}

/** Copia propia de un documento (por ejemplo, el formato de acta que compartió la dirección). */
export async function copyDocumentAction(formData: FormData) {
  const session = await staff();
  const source = await academic.getDocument(session.accessToken, z.uuid().parse(formData.get("id")));
  const doc = await academic.createDocument(session.accessToken, {
    title: `Copia de ${source.title}`.slice(0, 120),
    template: source.template,
    content: source.content,
  });
  revalidatePath("/panel/documentos");
  redirect(`/panel/documentos/${doc.id}`);
}

export type SaveResult = { ok: true; doc: DocumentDto } | { ok: false; error: string; conflict?: boolean };

export async function saveDocumentAction(id: string, input: SaveDocumentInput): Promise<SaveResult> {
  const { accessToken } = await staff();
  const parsed = saveDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa el documento" };
  }
  try {
    const doc = await academic.saveDocument(accessToken, z.uuid().parse(id), parsed.data);
    revalidatePath("/panel/documentos");
    return { ok: true, doc };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { ok: false, error: err.message, conflict: err.status === 409 };
    }
    throw err;
  }
}

export async function deleteDocumentAction(formData: FormData) {
  const { accessToken } = await staff();
  await academic.deleteDocument(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/documentos");
  redirect("/panel/documentos");
}
