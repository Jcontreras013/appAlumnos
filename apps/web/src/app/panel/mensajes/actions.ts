"use server";

import {
  isRole,
  MESSAGING_ROLES,
  type MessageDto,
  messageInputSchema,
  pushDeviceSchema,
  pushSubscriptionSchema,
  startConversationSchema,
} from "@escolar/shared";
import { redirect } from "next/navigation";
import { getSession, requireRole } from "@/lib/dal";
import { identity, ServiceError } from "@/lib/identity";

/** Abre (o retoma) la conversación con un compañero y lleva a ella. */
export async function startConversationAction(formData: FormData) {
  const { accessToken } = await requireRole(...MESSAGING_ROLES);
  const parsed = startConversationSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) redirect("/panel/mensajes");
  const { id } = await identity.startConversation(accessToken, parsed.data.userId);
  redirect(`/panel/mensajes/${id}`);
}

export type SendResult = { ok: true; message: MessageDto } | { ok: false; error: string };

export async function sendMessageAction(conversationId: string, body: string): Promise<SendResult> {
  const { accessToken } = await requireRole(...MESSAGING_ROLES);
  const parsed = messageInputSchema.safeParse({ body });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Mensaje inválido" };
  try {
    return { ok: true, message: await identity.sendMessage(accessToken, conversationId, parsed.data.body) };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Este teléfono avisa de los mensajes de quien tiene la sesión abierta. */
export async function savePushAction(subscription: unknown): Promise<{ ok: boolean; error?: string }> {
  const { accessToken } = await requireRole(...MESSAGING_ROLES);
  const parsed = pushSubscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: "Este navegador no entregó una suscripción válida" };
  try {
    await identity.savePushSubscription(accessToken, parsed.data);
    return { ok: true };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Al desactivar los avisos o al cerrar sesión: este teléfono deja de avisar. Nunca falla. */
export async function removePushAction(endpoint: string): Promise<void> {
  const session = await getSession().catch(() => null);
  if (!session || !isRole(session.user.role)) return;
  if (!(MESSAGING_ROLES as readonly string[]).includes(session.user.role)) return;
  await identity.removePushSubscription(session.accessToken, endpoint).catch(() => {});
}

/** La app de Android en este teléfono avisa de los mensajes de quien tiene la sesión abierta. */
export async function saveNativePushAction(deviceToken: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession().catch(() => null);
  if (!session || !(MESSAGING_ROLES as readonly string[]).includes(session.user.role)) return { ok: false };
  const parsed = pushDeviceSchema.safeParse({ token: deviceToken, platform: "android" });
  if (!parsed.success) return { ok: false, error: "La app no entregó un identificador válido" };
  try {
    await identity.savePushDevice(session.accessToken, parsed.data);
    return { ok: true };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Al desactivar los avisos de la app o al cerrar sesión. Nunca falla. */
export async function removeNativePushAction(deviceToken: string): Promise<void> {
  const session = await getSession().catch(() => null);
  if (!session || !(MESSAGING_ROLES as readonly string[]).includes(session.user.role)) return;
  await identity.removePushDevice(session.accessToken, deviceToken).catch(() => {});
}
