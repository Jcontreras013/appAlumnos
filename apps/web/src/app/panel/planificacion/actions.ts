"use server";

import { planTemplateInputSchema, reviewPlanInputSchema, weekStartSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { getSession, requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError, fromZodError } from "@/lib/forms";

/** Crea la planificación de una clase para la semana (o abre la que ya existe) y va al editor. */
export async function createPlanAction(formData: FormData) {
  const { accessToken } = await getSession();
  const input = z
    .object({ assignmentId: z.uuid(), weekStart: weekStartSchema })
    .parse({ assignmentId: formData.get("assignmentId"), weekStart: formData.get("weekStart") });
  const { plan } = await academic.createPlan(accessToken, input);
  redirect(`/panel/planificacion/${plan.id}`);
}

/** Los campos llegan como "f.tema" o, si son por día, "f.actividades.lunes". */
function contentFrom(formData: FormData): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("f.")) continue;
    const [, key, day] = name.split(".");
    if (!key) continue;
    if (day) {
      const days = (content[key] ?? {}) as Record<string, string>;
      days[day] = String(value);
      content[key] = days;
    } else {
      content[key] = String(value);
    }
  }
  return content;
}

/** Guardar borrador o enviar a revisión (según el botón que se presionó). */
export async function savePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await getSession();
  const id = z.uuid().parse(formData.get("id"));
  const version = Number(formData.get("version")) || undefined;
  const content = contentFrom(formData);
  const send = formData.get("intent") === "enviar";
  try {
    if (send) await academic.submitPlan(accessToken, id, { content, version });
    else await academic.savePlan(accessToken, id, { content, version });
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath(`/panel/planificacion/${id}`);
  revalidatePath("/panel/planificacion");
  return {
    ok: true,
    message: send ? "Enviada a revisión. Te avisaremos aquí cuando la revisen." : "Borrador guardado.",
  };
}

export async function reviewPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador");
  const id = z.uuid().parse(formData.get("id"));
  const parsed = reviewPlanInputSchema.safeParse({
    decision: formData.get("decision"),
    comment: String(formData.get("comment") ?? ""),
  });
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    await academic.reviewPlan(accessToken, id, parsed.data);
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath(`/panel/planificacion/${id}`);
  revalidatePath("/panel/planificacion");
  return {
    ok: true,
    message: parsed.data.decision === "aprobar" ? "Planificación aprobada." : "Devuelta con observaciones.",
  };
}

export async function saveTemplateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("template") ?? "{}"));
  } catch {
    return { error: "No se pudo leer la plantilla" };
  }
  const parsed = planTemplateInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa la plantilla" };
  try {
    await academic.updatePlanTemplate(accessToken, parsed.data);
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath("/panel/planificacion/plantilla");
  return { ok: true, message: "Plantilla guardada. Se usa en las planificaciones nuevas." };
}
