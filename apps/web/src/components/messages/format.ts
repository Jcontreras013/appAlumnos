import type { MessagingRole } from "@escolar/shared";

/** Fechas y horas de los mensajes, siempre en hora de Honduras. */
const TZ = "America/Tegucigalpa";

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const TIME = new Intl.DateTimeFormat("es-HN", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("es-HN", { timeZone: TZ, weekday: "long" });
const LONG_DAY = new Intl.DateTimeFormat("es-HN", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const SHORT_DATE = new Intl.DateTimeFormat("es-HN", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

/** "2026-11-10" en Honduras: sirve para agrupar los mensajes por día. */
export const dayKey = (iso: string) => DAY_KEY.format(new Date(iso));

const daysBetween = (fromKey: string, toKey: string) =>
  Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86_400_000);

export const messageTime = (iso: string) => TIME.format(new Date(iso));

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Separador de días en la conversación: "Hoy", "Ayer", "Martes 10 de noviembre". */
export function dayLabel(iso: string, now = new Date()): string {
  const diff = daysBetween(dayKey(iso), DAY_KEY.format(now));
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return capitalize(LONG_DAY.format(new Date(iso)));
}

/** En la lista: la hora si fue hoy, "Ayer", el día de la semana o la fecha corta. */
export function listTime(iso: string, now = new Date()): string {
  const diff = daysBetween(dayKey(iso), DAY_KEY.format(now));
  if (diff === 0) return messageTime(iso);
  if (diff === 1) return "Ayer";
  if (diff < 7) return capitalize(WEEKDAY.format(new Date(iso)));
  return SHORT_DATE.format(new Date(iso));
}

export function initials(name: string): string {
  const words = name
    .replace(/^(prof|profa|lic|licda|ing|dr|dra)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

export const ROLE_SHORT: Record<MessagingRole, string> = {
  admin: "Dirección",
  docente: "Docente",
};

/** Avisa a la lista y al menú que algo cambió (se envió o se leyó un mensaje). */
export const MESSAGES_CHANGED = "conecta:mensajes";
export const notifyMessagesChanged = () => window.dispatchEvent(new Event(MESSAGES_CHANGED));
