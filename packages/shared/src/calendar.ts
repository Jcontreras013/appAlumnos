import { z } from "zod";
import { addDays, classDayKeys, DEFAULT_CLASS_DAYS, isIsoDate, WEEKDAYS, type Weekday } from "./weeks";

/*
 * Calendario escolar: los días sin clases del centro (feriados, vacaciones, días libres). Los marca
 * la secretaría o la dirección. En esos días no se espera asistencia ni que haya maestro en el aula,
 * y una semana entera sin clases no pide planificación.
 */

export const DAY_OFF_KINDS = ["feriado", "vacaciones", "otro"] as const;
export type DayOffKind = (typeof DAY_OFF_KINDS)[number];
export const DAY_OFF_LABELS: Record<DayOffKind, string> = {
  feriado: "Feriado",
  vacaciones: "Vacaciones",
  otro: "Día sin clases",
};

/** Un período sin clases no puede pasar de este largo (unas vacaciones largas, no el año entero). */
export const DAY_OFF_MAX_DAYS = 120;

const isoDate = z.string().refine(isIsoDate, { error: "Fecha inválida" });

export const dayOffInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, { error: "Escribe el motivo (por ejemplo, «Día de la Independencia»)" })
      .max(80),
    kind: z.enum(DAY_OFF_KINDS, { error: "Elige el tipo" }),
    startsOn: isoDate,
    /** Vacío: un solo día. */
    endsOn: isoDate.optional(),
  })
  .transform((v) => ({ ...v, endsOn: v.endsOn ?? v.startsOn }))
  .refine((v) => v.startsOn <= v.endsOn, {
    error: "La fecha final no puede ser antes de la inicial",
    path: ["endsOn"],
  })
  .refine((v) => daysBetween(v.startsOn, v.endsOn) < DAY_OFF_MAX_DAYS, {
    error: `Un período sin clases no puede pasar de ${DAY_OFF_MAX_DAYS} días`,
    path: ["endsOn"],
  });
export type DayOffInput = z.infer<typeof dayOffInputSchema>;

export interface DayOffDto {
  id: string;
  name: string;
  kind: DayOffKind;
  startsOn: string;
  /** Igual a startsOn si es un solo día. */
  endsOn: string;
}

export interface SchoolCalendarDto {
  schoolYear: { id: string; name: string; startsOn: string; endsOn: string } | null;
  daysOff: DayOffDto[];
  /** Si hoy no hay clases, por qué. */
  today: DayOffDto | null;
  canEdit: boolean;
}

/** Días entre dos fechas AAAA-MM-DD (0 si son la misma). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** El período sin clases que incluye esta fecha, si hay. */
export function dayOffOn<T extends Pick<DayOffDto, "startsOn" | "endsOn">>(
  date: string,
  daysOff: T[],
): T | null {
  return daysOff.find((d) => d.startsOn <= date && date <= d.endsOn) ?? null;
}

/** Fecha de un día de la semana que empieza el lunes `weekStart`. */
export const dateOfWeekday = (weekStart: string, day: Weekday) => addDays(weekStart, WEEKDAYS.indexOf(day));

/** Los días de clase de esa semana que no caen en feriado ni vacaciones. */
export function openClassDays(
  weekStart: string,
  classDays: readonly Weekday[],
  daysOff: Array<Pick<DayOffDto, "startsOn" | "endsOn">>,
): Weekday[] {
  return classDays.filter((day) => !dayOffOn(dateOfWeekday(weekStart, day), daysOff));
}

/**
 * Si todos los días de clase de la semana (lunes a viernes, o los de la jornada) son sin clases, el
 * motivo (el del primer día de clase).
 */
export function weekOff<T extends Pick<DayOffDto, "startsOn" | "endsOn">>(
  weekStart: string,
  daysOff: T[],
  classDays: readonly number[] = DEFAULT_CLASS_DAYS,
): T | null {
  const days = classDayKeys(classDays.length ? classDays : DEFAULT_CLASS_DAYS);
  if (openClassDays(weekStart, days, daysOff).length) return null;
  return dayOffOn(dateOfWeekday(weekStart, days[0] ?? "lunes"), daysOff);
}

/** «15 de septiembre» o «del 21 de diciembre al 8 de enero». */
export function formatDayOffRange(
  d: Pick<DayOffDto, "startsOn" | "endsOn">,
  format: (iso: string) => string,
) {
  return d.startsOn === d.endsOn ? format(d.startsOn) : `del ${format(d.startsOn)} al ${format(d.endsOn)}`;
}
