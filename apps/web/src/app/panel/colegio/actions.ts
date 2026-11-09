"use server";

import { LOGO_MAX_BYTES, LOGO_MIME_TYPES } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError } from "@/lib/forms";
import { identity } from "@/lib/identity";

export async function uploadLogoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin");
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige una imagen" };
  if (file.size > LOGO_MAX_BYTES) return { error: "El logo pesa más de 300 KB. Usa una imagen más pequeña." };
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { error: "El logo debe ser una imagen PNG, JPG o WebP" };
  }
  try {
    // identity vuelve a validar el tipo por el contenido del archivo, no por la extensión
    await identity.uploadLogo(accessToken, Buffer.from(await file.arrayBuffer()).toString("base64"));
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath("/panel", "layout");
  return { ok: true, message: "Logo actualizado." };
}

export async function removeLogoAction() {
  const { accessToken } = await requireRole("admin");
  await identity.removeLogo(accessToken);
  revalidatePath("/panel", "layout");
}
