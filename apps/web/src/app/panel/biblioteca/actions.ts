"use server";

import { libraryLinkInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

const staff = () => requireRole("admin", "coordinador", "secretaria", "docente");

export type LinkFormState = { ok: boolean; error: string | null; at: number };

/** Agrega un enlace (Educatrachos, un video, una página) a la biblioteca. */
export async function addLibraryLinkAction(_prev: LinkFormState, formData: FormData): Promise<LinkFormState> {
  const { accessToken } = await staff();
  const parsed = libraryLinkInputSchema.safeParse({
    title: formData.get("title"),
    url: formData.get("url"),
    description: formData.get("description"),
    gradeId: formData.get("gradeId"),
    subjectId: formData.get("subjectId"),
    audience: formData.get("audience"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisa los datos", at: Date.now() };
  }
  try {
    await academic.addLibraryLink(accessToken, parsed.data);
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, error: err.message, at: Date.now() };
    throw err;
  }
  revalidatePath("/panel/biblioteca");
  return { ok: true, error: null, at: Date.now() };
}

export async function removeLibraryItemAction(formData: FormData) {
  const { accessToken } = await staff();
  await academic.removeLibraryItem(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/biblioteca");
}
