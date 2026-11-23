import {
  type AttachmentKind,
  MESSAGING_ROLES,
  type MessagingRole,
  type PushPayload,
  withinNotifyHours,
} from "@escolar/shared";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  conversationMembers,
  conversations,
  memberships,
  pushDevices,
  pushSubscriptions,
  users,
} from "../db/schema";
import { noticeText } from "./attachments";
import type { Notifier } from "./push";

/** Personas del centro que usan los mensajes: cuenta y acceso activos, con un cargo habilitado. */
export async function messagingStaff(
  db: DbOrTx,
  schoolId: string,
  userIds?: string[],
): Promise<Map<string, { userId: string; name: string; role: MessagingRole }>> {
  const rows = await db
    .select({ userId: users.id, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.schoolId, schoolId),
        eq(memberships.active, true),
        eq(users.active, true),
        inArray(memberships.role, [...MESSAGING_ROLES]),
        userIds ? inArray(memberships.userId, userIds) : undefined,
      ),
    )
    .orderBy(asc(users.name));
  const staff = new Map<string, { userId: string; name: string; role: MessagingRole }>();
  for (const row of rows) {
    const role = row.role as MessagingRole;
    const seen = staff.get(row.userId);
    // Quien es directora y además da clases aparece como dirección.
    if (!seen || role === "admin") staff.set(row.userId, { userId: row.userId, name: row.name, role });
  }
  return staff;
}

export const pairKeyOf = (a: string, b: string) => [a, b].sort().join(":");

/**
 * Manda el aviso a todos los teléfonos de esas personas (navegadores con Web Push y la app de Android
 * por Firebase); borra los que ya no sirven. Devuelve cuántos avisos se entregaron.
 */
export async function pushToUsers(
  db: DbOrTx,
  notifier: Notifier,
  userIds: string[],
  payload: PushPayload,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const { web, native } = notifier;
  const [subscriptions, devices] = await Promise.all([
    web ? db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)) : [],
    native ? db.select().from(pushDevices).where(inArray(pushDevices.userId, userIds)) : [],
  ]);
  const results = await Promise.all([
    ...subscriptions.map(async (target) => {
      const result = (await web?.send(target, payload)) ?? "failed";
      if (result === "gone") await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, target.id));
      return result;
    }),
    ...devices.map(async (device) => {
      const result = (await native?.send(device.token, payload)) ?? "failed";
      if (result === "gone") await db.delete(pushDevices).where(eq(pushDevices.id, device.id));
      return result;
    }),
  ]);
  return results.filter((r) => r === "sent").length;
}

export const messagePayload = (
  conversationId: string,
  senderName: string,
  attachment: AttachmentKind | null = null,
): PushPayload => ({
  title: senderName,
  body: noticeText(attachment),
  url: `/panel/mensajes/${conversationId}`,
  tag: `conversacion-${conversationId}`,
});

/**
 * Avisa de lo que llegó fuera del horario de atención. Corre cada pocos minutos: fuera de horario no
 * hace nada; al empezar la jornada manda un solo aviso por persona con lo que tiene sin leer. Marcar y
 * avisar es una sola operación en la base de datos, así que con varias copias del servicio corriendo
 * nadie recibe el aviso dos veces.
 */
export async function sendPendingNotices(db: DbOrTx, notifier: Notifier, now: Date): Promise<number> {
  if (!withinNotifyHours(now)) return 0;
  const claimed = await db
    .update(conversationMembers)
    .set({ notifiedAt: sql`${conversations.lastMessageAt}` })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationMembers.conversationId),
        isNotNull(conversations.lastMessageAt),
        ne(conversations.lastSenderId, conversationMembers.userId),
        sql`${conversations.lastMessageAt} > coalesce(${conversationMembers.lastReadAt}, '-infinity'::timestamptz)`,
        sql`${conversations.lastMessageAt} > coalesce(${conversationMembers.notifiedAt}, '-infinity'::timestamptz)`,
      ),
    )
    .returning({ userId: conversationMembers.userId });
  const perUser = new Map<string, number>();
  for (const { userId } of claimed) perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  let sent = 0;
  for (const [userId, count] of perUser) {
    sent += await pushToUsers(db, notifier, [userId], {
      title: "Mensajes nuevos",
      body:
        count === 1
          ? "Tienes un mensaje sin leer de un compañero."
          : `Tienes mensajes sin leer de ${count} compañeros.`,
      url: "/panel/mensajes",
      tag: "mensajes-pendientes",
    });
  }
  return sent;
}
