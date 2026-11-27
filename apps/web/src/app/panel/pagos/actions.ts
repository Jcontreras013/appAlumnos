"use server";

import {
  feeInputSchema,
  officePaymentInputSchema,
  paymentSettingsInputSchema,
  voidPaymentSchema,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError, fromZodError, runFormAction } from "@/lib/forms";

const office = () => requireRole("admin", "secretaria");

export async function createFeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await office();
  return runFormAction(formData, {
    schema: feeInputSchema,
    fields: ["name", "amount", "dueOn", "scope", "gradeId", "sectionId", "targetId"],
    build: (v) => ({
      ...v,
      targetId: v.scope === "grado" ? v.gradeId : v.scope === "seccion" ? v.sectionId : v.targetId,
    }),
    submit: async (input) => {
      // El servicio vuelve a validar y pasa a centavos: se le manda el monto tal como se escribió.
      const res = await academic.createFee(accessToken, { ...input, amount: String(formData.get("amount")) });
      revalidatePath("/panel/pagos", "layout");
      return `Cobro creado para ${res.students} ${res.students === 1 ? "alumno" : "alumnos"} (${res.scopeLabel}).`;
    },
  });
}

export async function cancelFeeAction(formData: FormData) {
  const { accessToken } = await requireRole("admin");
  await academic.cancelFee(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/pagos", "layout");
}

/** Registrar en la oficina el pago de los cobros marcados; al terminar se abre el recibo. */
export async function recordPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await office();
  const parsed = officePaymentInputSchema.safeParse({
    studentId: formData.get("studentId"),
    chargeIds: formData.getAll("chargeIds"),
    method: formData.get("method"),
    reference: formData.get("reference") ?? undefined,
  });
  if (!parsed.success) return fromZodError(parsed.error);
  let id: string;
  try {
    id = (await academic.recordPayment(accessToken, parsed.data)).id;
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath("/panel/pagos", "layout");
  redirect(`/panel/pagos/recibo/${id}?nuevo=1`);
}

export async function voidPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin");
  const parsed = voidPaymentSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return fromZodError(parsed.error);
  try {
    await academic.voidPayment(accessToken, z.uuid().parse(formData.get("id")), parsed.data.reason);
  } catch (err) {
    return fromServiceError(err);
  }
  revalidatePath("/panel/pagos", "layout");
  return { ok: true, message: "Pago anulado. Los cobros volvieron a quedar pendientes." };
}

export async function savePaymentSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin");
  return runFormAction(formData, {
    schema: paymentSettingsInputSchema,
    fields: ["enabled", "mode", "endpoint", "keyId", "secretKey"],
    build: (v) => ({ ...v, enabled: v.enabled === "on" }),
    submit: async (input) => {
      const saved = await academic.savePaymentSettings(accessToken, input);
      revalidatePath("/panel/pagos", "layout");
      return saved.enabled
        ? `Listo: las familias ya pueden pagar con tarjeta${saved.mode === "sandbox" ? " (modo de prueba: no se cobra de verdad)" : ""}.`
        : "Guardado. El pago con tarjeta está apagado.";
    },
  });
}

/** La dirección pública de CONECTA a la que vuelve la familia desde PixelPay. */
async function publicBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

export type CheckoutState = FormState & { checkout?: { action: string; fields: Record<string, string> } };

/**
 * La familia paga con tarjeta: se crea la orden firmada y la página la envía a PixelPay (el navegador
 * hace el envío, como pide Hosted Payment).
 */
export async function payOnlineAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const { accessToken } = await requireRole("padre");
  const studentId = z.uuid().parse(formData.get("studentId"));
  const chargeIds = formData.getAll("chargeIds").map(String);
  const email = String(formData.get("email") ?? "").trim();
  if (!chargeIds.length) return { error: "Marca lo que quieres pagar", values: { email } };
  if (!z.email().safeParse(email).success) {
    return {
      error: "Revisa los campos marcados",
      fields: { email: "Escribe un correo válido para el comprobante" },
      values: { email },
    };
  }
  try {
    const { action, fields } = await academic.payOnline(accessToken, studentId, {
      chargeIds,
      email,
      returnBase: await publicBase(),
    });
    return { checkout: { action, fields }, values: { email } };
  } catch (err) {
    return { ...fromServiceError(err), values: { email } };
  }
}
