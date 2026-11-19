import { z } from "zod";
import type { SchoolRole } from "./roles";

/*
 * Mensajes entre el personal del centro: conversaciones de dos personas, como un chat. En esta
 * primera etapa solo entre maestros y dirección; las familias quedan para más adelante.
 *
 * - Los mensajes no se borran: son el registro de lo que se habló.
 * - Cada persona ve si el otro ya leyó lo que le escribió ("visto").
 * - Avisos en el celular solo en horario de atención; lo que llega de noche o el fin de semana se
 *   avisa al empezar la jornada.
 */

/** Quiénes usan los mensajes. Agregar un cargo aquí lo habilita en el panel y en el servicio. */
export const MESSAGING_ROLES = ["admin", "docente"] as const satisfies readonly SchoolRole[];
export type MessagingRole = (typeof MESSAGING_ROLES)[number];

export const MESSAGE_MAX_LENGTH = 2000;

export const messageInputSchema = z.object({
  body: z
    .string({ error: "Escribe el mensaje" })
    .trim()
    .min(1, { error: "Escribe el mensaje" })
    .max(MESSAGE_MAX_LENGTH, { error: `Máximo ${MESSAGE_MAX_LENGTH} caracteres` }),
});
export type MessageInput = z.infer<typeof messageInputSchema>;

export const startConversationSchema = z.object({ userId: z.uuid({ error: "Elige a una persona" }) });

/** Persona del centro a la que se le puede escribir. */
export interface MessageContactDto {
  userId: string;
  name: string;
  role: MessagingRole;
}

export interface ConversationPersonDto {
  userId: string;
  name: string;
  /** null si ya no trabaja en el centro. */
  role: MessagingRole | null;
}

export interface ConversationSummaryDto {
  id: string;
  other: ConversationPersonDto;
  lastMessage: { body: string; sentAt: string; mine: boolean } | null;
  /** Mensajes del otro que todavía no leí. */
  unread: number;
}

export interface MessageDto {
  id: string;
  body: string;
  sentAt: string;
  mine: boolean;
  /** En los míos: si el otro ya lo leyó. */
  seen: boolean;
}

export interface ConversationDto {
  id: string;
  other: ConversationPersonDto;
  /** Los más recientes, del más viejo al más nuevo. */
  messages: MessageDto[];
  /** Hay mensajes más viejos que estos (se piden con `antes`). */
  hasOlder: boolean;
  /** Se puede escribir mientras la otra persona siga en el centro. */
  canSend: boolean;
}

export interface UnreadMessagesDto {
  /** Conversaciones con mensajes sin leer. */
  conversations: number;
}

// ───────────────────────────── Avisos en el celular ─────────────────────────────

/**
 * Horario de atención (hora de Honduras): lunes a viernes de 6:00 a 19:00. Fuera de ese horario los
 * mensajes llegan, pero el teléfono no avisa hasta que empieza la jornada.
 */
export const NOTIFY_HOURS = { from: 6, to: 19, weekdays: [1, 2, 3, 4, 5] } as const;

/** Honduras no cambia de horario: siempre UTC-6. */
const HONDURAS_OFFSET_MS = 6 * 60 * 60 * 1000;

export function withinNotifyHours(at: Date): boolean {
  const local = new Date(at.getTime() - HONDURAS_OFFSET_MS);
  const hour = local.getUTCHours();
  return (
    (NOTIFY_HOURS.weekdays as readonly number[]).includes(local.getUTCDay()) &&
    hour >= NOTIFY_HOURS.from &&
    hour < NOTIFY_HOURS.to
  );
}

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url({ error: "Suscripción inválida" })
    .max(1000)
    .refine((url) => url.startsWith("https://"), { error: "Suscripción inválida" }),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({ endpoint: z.string().min(1).max(1000) });

export interface PushKeyDto {
  /** Llave pública para suscribirse; null si la instalación no tiene avisos configurados. */
  publicKey: string | null;
}

/** Lo que recibe el service worker para mostrar el aviso. Nunca lleva el texto del mensaje. */
export interface PushPayload {
  title: string;
  body: string;
  /** A dónde lleva al tocar el aviso. */
  url: string;
  /** Avisos con la misma etiqueta se reemplazan en vez de amontonarse. */
  tag: string;
}
