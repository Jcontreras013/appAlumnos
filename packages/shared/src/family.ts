import { z } from "zod";
import { nationalIdSchema } from "./enrollment";
import type { AttendanceStatus, GradingPeriodDto } from "./evaluation";
import { emailSchema } from "./schemas";
import type { FamilyAccountDto } from "./types";

/*
 * Portal de familias: el padre, la madre o el encargado ve las notas, la asistencia y las tareas de
 * sus hijos. La cuenta la crea la secretaría o la dirección desde la ficha del alumno.
 */

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Con qué entrará el encargado: si no se indica, se usa la identidad o el correo de su ficha. */
export const portalAccessInputSchema = z.object({
  nationalId: z.preprocess(blankToUndefined, nationalIdSchema.optional()),
  email: z.preprocess(blankToUndefined, emailSchema.optional()),
});
export type PortalAccessInput = z.infer<typeof portalAccessInputSchema>;

export interface PortalAccessDto extends FamilyAccountDto {
  guardianId: string;
  guardianName: string;
  /** Hijos que verá en el portal (en este centro). */
  children: string[];
}

export interface FamilyGradeDto {
  /** Nota del parcial cuando ya se evaluaron los 100 puntos. */
  grade: number | null;
  /** Proyección en base 100 con lo evaluado hasta ahora. */
  projected: number | null;
  points: number;
  possible: number;
}

export interface FamilySubjectDto {
  assignmentId: string;
  subjectName: string;
  teacherName: string;
  /** Por parcial (clave: id del parcial). */
  grades: Record<string, FamilyGradeDto>;
  /** Actividades del parcial vigente con lo que sacó. */
  activities: Array<{ name: string; date: string; maxPoints: number; points: number | null }>;
  /** Promedio de los parciales ya cerrados con nota. */
  average: number | null;
  atRisk: boolean;
}

export interface FamilyHomeworkDto {
  subjectName: string;
  weekStart: string;
  topic: string | null;
  homework: string | null;
}

export interface FamilyChildDto {
  student: {
    id: string;
    name: string;
    nationalId: string | null;
    sectionLabel: string | null;
    schoolYearName: string | null;
  };
  passingGrade: number;
  periods: GradingPeriodDto[];
  period: GradingPeriodDto | null;
  subjects: FamilySubjectDto[];
  attendance: {
    rate30d: number | null;
    absences30d: number;
    tardies30d: number;
    justified30d: number;
    recordedDays30d: number;
    /** En lo que va del año lectivo. */
    yearRate: number | null;
    /** Días de los últimos 60 en que no estuvo presente (ausente, tarde o justificada). */
    recent: Array<{ date: string; status: AttendanceStatus }>;
  };
  /** Tareas y temas de esta semana y la próxima (de la planificación de cada maestro). */
  homework: FamilyHomeworkDto[];
  generalAverage: number | null;
  atRisk: boolean;
}

export interface FamilyChildSummaryDto {
  studentId: string;
  name: string;
  sectionLabel: string | null;
  periodName: string | null;
  /** Promedio (proyectado) del parcial vigente. */
  periodAverage: number | null;
  attendanceRate30d: number | null;
  absences30d: number;
  subjectsAtRisk: string[];
  homeworkThisWeek: number;
}
