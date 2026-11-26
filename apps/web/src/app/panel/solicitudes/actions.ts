"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError } from "@/lib/forms";

/** La dirección confirma (y entonces se crea lo pedido) o rechaza una solicitud de la secretaría. */
export async function decideChangeRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin");
  const id = z.uuid().parse(formData.get("id"));
  const decision = formData.get("decision") === "rechazar" ? "rechazar" : "confirmar";
  try {
    const done =
      decision === "confirmar"
        ? await academic.approveChangeRequest(accessToken, id)
        : await academic.rejectChangeRequest(
            accessToken,
            id,
            String(formData.get("note") ?? "").trim() || undefined,
          );
    revalidatePath("/panel", "layout");
    return {
      ok: true,
      message: decision === "confirmar" ? `Listo: ${done.summary}.` : `Rechazada: ${done.summary}.`,
    };
  } catch (err) {
    return fromServiceError(err);
  }
}
