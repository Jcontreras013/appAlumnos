import { z } from "zod";
import type { SchoolRole } from "./roles";

/*
 * Mensajes entre el personal del centro: conversaciones de dos personas, como un chat. En esta
 * primera etapa entre maestros, dirección y secretaría; las familias quedan para más adelante.
 *
 * - Los mensajes no se borran: son el registro de lo que se habló.
 * - Cada persona ve si el otro ya leyó lo que le escribió ("visto").
 * - Avisos en el celular solo en horario de atención; lo que llega de noche o el fin de semana se
 *   avisa al empezar la jornada.
 */

/** Quiénes usan los mensajes. Agregar un cargo aquí lo habilita en el panel y en el servicio. */
export const MESSAGING_ROLES = ["admin", "secretaria", "docente"] as const satisfies readonly SchoolRole[];
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
  lastMessage: {
    body: string;
    sentAt: string;
    mine: boolean;
    /** Si el último fue una foto, un video o un documento. */
    attachment: { kind: AttachmentKind; name: string } | null;
  } | null;
  /** Mensajes del otro que todavía no leí. */
  unread: number;
}

export interface MessageDto {
  id: string;
  /** Vacío en los mensajes que son solo un adjunto. */
  body: string;
  sentAt: string;
  mine: boolean;
  /** En los míos: si el otro ya lo leyó. */
  seen: boolean;
  attachment: AttachmentDto | null;
}

// ───────────────────────────── Fotos, videos y documentos ─────────────────────────────

/**
 * Cada adjunto viaja en su propio mensaje (como en WhatsApp). Igual que el texto, no se borra: queda
 * como registro de la conversación. Las fotos se achican en el celular antes de enviarse.
 */
export const ATTACHMENT_KINDS = ["foto", "video", "archivo"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const MB = 1024 * 1024;
/** Tamaño máximo por adjunto. */
export const ATTACHMENT_MAX_BYTES: Record<AttachmentKind, number> = {
  foto: 10 * MB,
  video: 50 * MB,
  archivo: 10 * MB,
};
/** Videos cortos: el panel no deja enviar uno más largo (el tamaño lo revisa también el servicio). */
export const VIDEO_MAX_SECONDS = 60;
/** Cuántos adjuntos se eligen de una vez. */
export const ATTACHMENTS_PER_SEND = 5;
/** Las fotos se achican a este lado mayor (en píxeles) antes de enviarse. */
export const PHOTO_MAX_SIDE = 1600;

/** Tipos que se aceptan, con su clase y la extensión con la que se descargan. */
export const ATTACHMENT_TYPES: Record<string, { kind: AttachmentKind; ext: string }> = {
  "image/jpeg": { kind: "foto", ext: "jpg" },
  "image/png": { kind: "foto", ext: "png" },
  "image/webp": { kind: "foto", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
  "video/3gpp": { kind: "video", ext: "3gp" },
  "application/pdf": { kind: "archivo", ext: "pdf" },
  "application/msword": { kind: "archivo", ext: "doc" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "archivo", ext: "docx" },
  "application/vnd.ms-excel": { kind: "archivo", ext: "xls" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "archivo", ext: "xlsx" },
  "application/vnd.ms-powerpoint": { kind: "archivo", ext: "ppt" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    kind: "archivo",
    ext: "pptx",
  },
};

/** El tipo de un archivo por su extensión (algunos celulares no lo dicen al elegirlo). */
export function attachmentTypeOf(fileName: string, declared?: string): string | null {
  if (declared && ATTACHMENT_TYPES[declared]) return declared;
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpeg") return "image/jpeg";
  const found = Object.entries(ATTACHMENT_TYPES).find(([, t]) => t.ext === ext);
  return found ? found[0] : null;
}

/** Nombre seguro para guardar y descargar: sin rutas ni caracteres de control, y no muy largo. */
export function cleanFileName(name: string, fallbackExt: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127 && !'"<>|:*?'.includes(ch);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return `adjunto.${fallbackExt}`;
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export interface AttachmentDto {
  id: string;
  kind: AttachmentKind;
  name: string;
  contentType: string;
  /** En bytes. */
  size: number;
}

/** "2.4 MB", "830 KB" */
export function formatFileSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  foto: "Foto",
  video: "Video",
  archivo: "Documento",
};

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
 * Horario de atención (hora de Honduras): lunes a viernes de 6:00 a 19:00, y también sábado y domingo
 * en los centros con jornada de fin de semana. Fuera de ese horario los mensajes llegan, pero el
 * teléfono no avisa hasta que empieza la jornada.
 */
export const NOTIFY_HOURS = { from: 6, to: 19, weekdays: [1, 2, 3, 4, 5], weekend: [0, 6] } as const;

/** Honduras no cambia de horario: siempre UTC-6. */
const HONDURAS_OFFSET_MS = 6 * 60 * 60 * 1000;

/** ¿Es sábado o domingo en Honduras? */
export function isWeekendInHonduras(at: Date): boolean {
  const local = new Date(at.getTime() - HONDURAS_OFFSET_MS);
  return (NOTIFY_HOURS.weekend as readonly number[]).includes(local.getUTCDay());
}

/** `weekends`: el centro tiene clases sábado o domingo, así que esos días también se avisa. */
export function withinNotifyHours(at: Date, options: { weekends?: boolean } = {}): boolean {
  const local = new Date(at.getTime() - HONDURAS_OFFSET_MS);
  const hour = local.getUTCHours();
  const days: readonly number[] = options.weekends
    ? [...NOTIFY_HOURS.weekdays, ...NOTIFY_HOURS.weekend]
    : NOTIFY_HOURS.weekdays;
  return days.includes(local.getUTCDay()) && hour >= NOTIFY_HOURS.from && hour < NOTIFY_HOURS.to;
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
  /** ¿La instalación manda avisos a la app de Android (Firebase)? */
  nativeAvailable: boolean;
}

/** El teléfono con la app de Android, para avisarle por Firebase (el identificador que da Firebase). */
export const pushDeviceSchema = z.object({
  token: z
    .string()
    .min(20)
    .max(4096)
    .regex(/^[\w:.-]+$/, { error: "Identificador inválido" }),
  platform: z.literal("android"),
});
export type PushDeviceInput = z.infer<typeof pushDeviceSchema>;

export const pushDeviceTokenSchema = z.object({ token: z.string().min(1).max(4096) });

/** Lo que recibe el service worker para mostrar el aviso. Nunca lleva el texto del mensaje. */
export interface PushPayload {
  title: string;
  body: string;
  /** A dónde lleva al tocar el aviso. */
  url: string;
  /** Avisos con la misma etiqueta se reemplazan en vez de amontonarse. */
  tag: string;
}
