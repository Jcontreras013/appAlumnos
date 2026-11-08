/**
 * Semanas escolares. Una semana se identifica por la fecha de su lunes en formato ISO ("2026-11-09").
 * Se trabaja con fechas de calendario (sin hora) para no depender de la zona horaria del servidor.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(date: string): Date {
  if (!ISO_DATE.test(date)) throw new Error(`Fecha inválida: ${date}`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Fecha inválida: ${date}`);
  }
  return parsed;
}

const toIso = (date: Date) => date.toISOString().slice(0, 10);

export function isIsoDate(value: string): boolean {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function isMonday(date: string): boolean {
  return isIsoDate(date) && parse(date).getUTCDay() === 1;
}

/** Lunes de la semana a la que pertenece la fecha (los domingos cuentan como fin de la semana anterior). */
export function mondayOf(date: string): string {
  const day = parse(date).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/** Hoy en Honduras (UTC-6, sin horario de verano). */
export function todayInHonduras(now: Date = new Date()): string {
  return toIso(new Date(now.getTime() - 6 * 60 * 60 * 1000));
}

export function currentWeek(now: Date = new Date()): string {
  return mondayOf(todayInHonduras(now));
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "9 al 13 de nov de 2026" (de lunes a viernes). */
export function formatWeekRange(weekStart: string): string {
  const start = parse(weekStart);
  const end = parse(addDays(weekStart, 4));
  const month = (d: Date) => MONTHS[d.getUTCMonth()];
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startText = sameMonth ? `${start.getUTCDate()}` : `${start.getUTCDate()} de ${month(start)}`;
  return `${startText} al ${end.getUTCDate()} de ${month(end)} de ${end.getUTCFullYear()}`;
}

export const WEEKDAYS = ["lunes", "martes", "miercoles", "jueves", "viernes"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
};
