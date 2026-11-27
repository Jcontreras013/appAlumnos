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

/**
 * "9 al 13 de nov de 2026": del primer al último día de clase de la semana (de lunes a viernes si no
 * se dice otra cosa; "14 al 15 de nov de 2026" en una jornada de fin de semana).
 */
export function formatWeekRange(
  weekStart: string,
  classDays: readonly number[] = DEFAULT_CLASS_DAYS,
): string {
  const days = classDays.length ? [...classDays].sort((a, b) => a - b) : [...DEFAULT_CLASS_DAYS];
  const start = parse(addDays(weekStart, (days[0] ?? 1) - 1));
  const end = parse(addDays(weekStart, (days[days.length - 1] ?? 5) - 1));
  const month = (d: Date) => MONTHS[d.getUTCMonth()];
  if (start.getTime() === end.getTime()) {
    return `${start.getUTCDate()} de ${month(start)} de ${start.getUTCFullYear()}`;
  }
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const startText = sameMonth ? `${start.getUTCDate()}` : `${start.getUTCDate()} de ${month(start)}`;
  return `${startText} al ${end.getUTCDate()} de ${month(end)} de ${end.getUTCFullYear()}`;
}

/** Los siete días; el número de cada uno es su posición + 1 (1 = lunes … 7 = domingo). */
export const WEEKDAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};

/** Días de clase de un centro (o jornada) que no ha dicho otra cosa: lunes a viernes. */
export const DEFAULT_CLASS_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** 1 = lunes … 7 = domingo. */
export const weekdayOf = (day: number): Weekday => WEEKDAYS[day - 1] ?? "lunes";

/** Los días de clase (números) como claves, en orden de la semana. */
export const classDayKeys = (days: readonly number[]): Weekday[] =>
  [...days].sort((a, b) => a - b).map(weekdayOf);

/** «lunes a viernes», «sábado y domingo», «lunes, miércoles y viernes», «domingo». */
export function describeClassDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const names = sorted.map((d) => WEEKDAY_LABELS[weekdayOf(d)].toLowerCase());
  if (!names.length) return "";
  const consecutive = sorted.every((d, i) => i === 0 || d === (sorted[i - 1] ?? 0) + 1);
  if (consecutive && names.length >= 3) return `${names[0]} a ${names[names.length - 1]}`;
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Jornada que se ve una o dos veces por semana (fin de semana, dominical): «encuentros» largos. */
export const isMeetingSchedule = (days: readonly number[]) => days.length > 0 && days.length <= 2;

/** El próximo día de clase desde `date` (sin contarlo), dentro de los días de la jornada. */
export function nextClassDay(date: string, classDays: readonly number[]): string {
  const days = classDays.length ? classDays : DEFAULT_CLASS_DAYS;
  for (let i = 1; i <= 7; i++) {
    const candidate = addDays(date, i);
    const weekday = parse(candidate).getUTCDay() || 7;
    if (days.includes(weekday)) return candidate;
  }
  return addDays(date, 7);
}
