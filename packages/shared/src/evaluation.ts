import { z } from "zod";
import type { AssignmentDto, SectionDto } from "./academic";
import { addDays, isIsoDate } from "./weeks";

/*
 * Evaluación como se trabaja en las escuelas de Honduras: el año se divide en parciales (por defecto
 * cuatro); en cada parcial el maestro reparte 100 puntos entre actividades (tareas, trabajos,
 * pruebas, examen) y la nota del parcial es la suma de lo que el alumno acumuló. La nota mínima de
 * aprobación es configurable por centro (por defecto 70). Las notas oficiales se pasan al SACE.
 */

export const DEFAULT_PASSING_GRADE = 70;
export const DEFAULT_PERIOD_COUNT = 4;
export const PERIOD_NAMES = [
  "I Parcial",
  "II Parcial",
  "III Parcial",
  "IV Parcial",
  "V Parcial",
  "VI Parcial",
];

/** Umbrales de la alerta temprana. */
export const RISK_RULES = {
  /** Ventana para medir asistencia. */
  attendanceWindowDays: 30,
  /** Por debajo de este porcentaje de asistencia el alumno está en riesgo. */
  minAttendanceRate: 0.85,
  /** Mínimo de días registrados para opinar sobre la asistencia. */
  minAttendanceDays: 5,
  /** Ausencias injustificadas que por sí solas ponen al alumno en riesgo. */
  maxAbsences: 5,
  /** Puntos evaluados mínimos en el parcial para proyectar la nota. */
  minPointsToProject: 20,
};

const isoDate = z.string().refine(isIsoDate, { error: "Fecha inválida" });

// ───────────────────────────── Parciales ─────────────────────────────

export const periodsInputSchema = z
  .object({
    periods: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(40),
            startsOn: isoDate,
            endsOn: isoDate,
            /** Último día para tener las notas completas (antes de pasarlas al SACE). */
            closesOn: isoDate,
          })
          .refine((p) => p.startsOn <= p.endsOn && p.endsOn <= p.closesOn, {
            error: "Las fechas del parcial no están en orden (inicio ≤ fin ≤ cierre de notas)",
          }),
      )
      .min(1)
      .max(6),
  })
  .refine(({ periods }) => periods.every((p, i) => i === 0 || (periods[i - 1]?.endsOn ?? "") < p.startsOn), {
    error: "Los parciales no pueden cruzarse: cada uno empieza después de que termina el anterior",
  });
export type PeriodsInput = z.infer<typeof periodsInputSchema>;

/** Divide el año lectivo en `count` parciales de igual duración; las notas cierran 7 días después. */
export function defaultPeriods(
  startsOn: string,
  endsOn: string,
  count = DEFAULT_PERIOD_COUNT,
): PeriodsInput["periods"] {
  const totalDays =
    Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000) + 1;
  const size = Math.floor(totalDays / count);
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(startsOn, i * size);
    const end = i === count - 1 ? endsOn : addDays(startsOn, (i + 1) * size - 1);
    return {
      name: PERIOD_NAMES[i] ?? `Parcial ${i + 1}`,
      startsOn: start,
      endsOn: end,
      closesOn: addDays(end, 7),
    };
  });
}

/** Parcial vigente para una fecha: el que la contiene o, en vacaciones, el último que ya terminó. */
export function currentPeriod<T extends { startsOn: string; endsOn: string }>(
  periods: T[],
  date: string,
): T | null {
  const sorted = [...periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return (
    sorted.find((p) => p.startsOn <= date && date <= p.endsOn) ??
    [...sorted].reverse().find((p) => p.endsOn < date) ??
    sorted[0] ??
    null
  );
}

// ───────────────────────────── Notas ─────────────────────────────

export const activityInputSchema = z.object({
  /** El id lo genera el dispositivo: así una actividad creada sin internet se sincroniza sin duplicarse. */
  id: z.uuid(),
  assignmentId: z.uuid(),
  periodId: z.uuid(),
  name: z.string().trim().min(2, { error: "Escribe el nombre de la actividad" }).max(80),
  maxPoints: z.coerce
    .number()
    .min(0.5, { error: "El valor mínimo es 0.5 puntos" })
    .max(100, { error: "Una actividad no puede valer más de 100 puntos" })
    .refine((v) => Number.isInteger(v * 2), { error: "Usa enteros o medios puntos (ej. 7.5)" }),
  date: isoDate,
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

export const scoresInputSchema = z.object({
  activityId: z.uuid(),
  entries: z
    .array(
      z.object({
        studentId: z.uuid(),
        /** null = todavía sin nota (no entregó o no se ha calificado). */
        points: z.number().min(0).nullable(),
      }),
    )
    .min(1)
    .max(200),
});
export type ScoresInput = z.infer<typeof scoresInputSchema>;

/** Redondeo como en las boletas: 69.5 => 70. */
export const roundGrade = (value: number) => Math.floor(value + 0.5);

export interface PeriodGrade {
  /** Puntos que el alumno ha acumulado. */
  points: number;
  /** Puntos que ya se evaluaron en el parcial (lo ideal es que lleguen a 100). */
  possible: number;
  /** Nota del parcial (suma de puntos) cuando ya se evaluaron los 100 puntos; si no, null. */
  grade: number | null;
  /** Proyección en base 100 con lo evaluado hasta ahora (para detectar riesgo antes del cierre). */
  projected: number | null;
  /** Actividades evaluadas que no tienen nota para este alumno. */
  missing: number;
}

export function periodGrade(
  activities: Array<{ id: string; maxPoints: number }>,
  scores: Record<string, number | null | undefined>,
): PeriodGrade {
  let points = 0;
  let possible = 0;
  let missing = 0;
  for (const activity of activities) {
    possible += activity.maxPoints;
    const score = scores[activity.id];
    if (score === null || score === undefined) missing++;
    else points += Math.min(score, activity.maxPoints);
  }
  return {
    points: Math.round(points * 100) / 100,
    possible,
    grade: possible >= 100 ? roundGrade(points) : null,
    projected: possible > 0 ? roundGrade((points / possible) * 100) : null,
    missing,
  };
}

// ───────────────────────────── Asistencia ─────────────────────────────

export const ATTENDANCE_STATUSES = ["presente", "ausente", "tarde", "justificada"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  presente: "Presente",
  ausente: "Ausente",
  tarde: "Tarde",
  justificada: "Ausencia justificada",
};

export const attendanceInputSchema = z.object({
  sectionId: z.uuid(),
  date: isoDate,
  entries: z
    .array(z.object({ studentId: z.uuid(), status: z.enum(ATTENDANCE_STATUSES) }))
    .min(1)
    .max(200),
});
export type AttendanceInput = z.infer<typeof attendanceInputSchema>;

/** Asistencia efectiva: llegar tarde cuenta como asistió; la ausencia justificada no penaliza. */
export function attendanceRate(statuses: AttendanceStatus[]): number | null {
  const counted = statuses.filter((s) => s !== "justificada");
  if (counted.length === 0) return null;
  return counted.filter((s) => s !== "ausente").length / counted.length;
}

// ───────────────────────────── DTOs ─────────────────────────────

export interface GradingPeriodDto {
  id: string;
  number: number;
  name: string;
  startsOn: string;
  endsOn: string;
  closesOn: string;
}

export interface ActivityDto {
  id: string;
  name: string;
  maxPoints: number;
  date: string;
}

export interface GradebookStudentDto extends PeriodGrade {
  studentId: string;
  name: string;
  nationalId: string | null;
  scores: Record<string, number | null>;
  atRisk: boolean;
}

export interface GradebookDto {
  assignment: AssignmentDto;
  period: GradingPeriodDto;
  periods: GradingPeriodDto[];
  passingGrade: number;
  activities: ActivityDto[];
  students: GradebookStudentDto[];
  /** Puntos repartidos en el parcial (el maestro debe llegar a 100). */
  possible: number;
  /** Quién da la clase ahora (titular o sustituto). Solo esa persona y la dirección pueden calificar. */
  canEdit: boolean;
}

export interface AttendanceSheetDto {
  section: SectionDto;
  date: string;
  students: Array<{ studentId: string; name: string; status: AttendanceStatus | null }>;
  totals: Record<AttendanceStatus | "sin_registro", number>;
  canEdit: boolean;
}

export interface TeacherClassDto {
  assignment: AssignmentDto;
  /** La da porque cubre a otro maestro de licencia. */
  substituting: boolean;
  students: number;
}

export interface StudentRiskDto {
  studentId: string;
  name: string;
  sectionId: string;
  sectionLabel: string;
  attendanceRate: number | null;
  absences: number;
  failing: Array<{ subjectName: string; projected: number }>;
}

export interface GradeProgressDto {
  assignment: AssignmentDto;
  activities: number;
  possible: number;
  studentsComplete: number;
  students: number;
  complete: boolean;
}

export interface SchoolFollowUpDto {
  date: string;
  period: GradingPeriodDto | null;
  passingGrade: number;
  /** Días que faltan para el cierre de notas del parcial (negativo si ya pasó). */
  daysToClose: number | null;
  gradeProgress: { complete: number; total: number; items: GradeProgressDto[] };
  attendance: { rate7d: number | null; sectionsRecordedToday: number; sections: number };
  studentsAtRisk: StudentRiskDto[];
  /** Planificación semanal de la semana de `date`: entregadas = enviadas, devueltas o aprobadas. */
  plans: PlansSummaryDto;
}

export interface PlansSummaryDto {
  weekStart: string;
  deadline: string;
  total: number;
  delivered: number;
  approved: number;
  /** Sin entregar y con la fecha límite vencida. */
  overdue: number;
}
