import { z } from "zod";
import type { AssignmentDto } from "./academic";
import { isIsoDate } from "./weeks";

// ───────────────────────────── Licencias y sustituciones ─────────────────────────────

export const LEAVE_TYPES = [
  "vacaciones",
  "enfermedad",
  "maternidad",
  "capacitacion",
  "personal",
  "otra",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacaciones: "Vacaciones",
  enfermedad: "Enfermedad",
  maternidad: "Maternidad / paternidad",
  capacitacion: "Capacitación",
  personal: "Permiso personal",
  otra: "Otra",
};

const isoDate = z.string().refine(isIsoDate, { error: "Fecha inválida" });
const optionalIsoDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), isoDate.optional());

export const leaveInputSchema = z
  .object({
    teacherUserId: z.uuid({ error: "Elige al maestro" }),
    type: z.enum(LEAVE_TYPES, { error: "Elige el tipo de licencia" }),
    startsOn: isoDate,
    endsOn: isoDate,
    notes: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(500).optional(),
    ),
  })
  .refine((v) => v.startsOn <= v.endsOn, {
    error: "La fecha de regreso no puede ser antes del inicio",
    path: ["endsOn"],
  });
export type LeaveInput = z.infer<typeof leaveInputSchema>;

export const substitutionInputSchema = z
  .object({
    assignmentId: z.uuid({ error: "Elige la clase" }),
    substituteUserId: z.uuid({ error: "Elige al maestro sustituto" }),
    /** Por defecto, toda la licencia. Se puede cubrir solo una parte. */
    startsOn: optionalIsoDate,
    endsOn: optionalIsoDate,
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn, {
    error: "La fecha final no puede ser antes del inicio",
    path: ["endsOn"],
  });
export type SubstitutionInput = z.infer<typeof substitutionInputSchema>;

export interface SubstitutionDto {
  id: string;
  leaveId: string;
  assignmentId: string;
  substituteUserId: string;
  substituteName: string;
  startsOn: string;
  endsOn: string;
}

export interface LeaveDto {
  id: string;
  teacherUserId: string;
  teacherName: string;
  type: LeaveType;
  startsOn: string;
  endsOn: string;
  notes: string | null;
  createdByName: string;
  cancelled: boolean;
  /** Clases del maestro en el año vigente, con su sustituto si ya lo tienen. */
  classes: Array<{ assignment: AssignmentDto; substitution: SubstitutionDto | null }>;
  createdAt: string;
}

export type CoverageStatus = "normal" | "cubierta" | "sin_cubrir";

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  normal: "Con su maestro",
  cubierta: "Cubierta por sustituto",
  sin_cubrir: "Sin maestro",
};

export interface CoverageRowDto {
  assignment: AssignmentDto;
  status: CoverageStatus;
  leave: Pick<LeaveDto, "id" | "type" | "startsOn" | "endsOn"> | null;
  substitute: Pick<SubstitutionDto, "id" | "substituteUserId" | "substituteName" | "endsOn"> | null;
}

export interface CoverageDto {
  date: string;
  rows: CoverageRowDto[];
  totals: Record<CoverageStatus, number>;
  /** Maestros con licencia vigente ese día. */
  teachersOnLeave: number;
}

// ───────────────────────────── Tablero departamental / distrital ─────────────────────────────

export interface RegionalSchoolSummaryDto {
  schoolId: string;
  schoolName: string;
  districtName: string | null;
  logoVersion: number | null;
  /** Año lectivo vigente del centro (cada centro configura el suyo). */
  schoolYear: string | null;
  students: number;
  sections: number;
  teachers: number;
  classes: number;
  teachersOnLeave: number;
  uncoveredClasses: number;
  /** Asistencia de los alumnos en los últimos 7 días (null si no se ha registrado). */
  attendanceRate7d: number | null;
  studentsAtRisk: number;
  /** Parcial vigente y avance de notas: clases con notas completas / clases. */
  periodName: string | null;
  periodClosesOn: string | null;
  gradeProgress: { complete: number; total: number };
  /** Faltan 7 días o menos para el cierre de notas (o ya pasó) y no están completas. */
  behindOnGrades: boolean;
}

export interface RegionalOverviewDto {
  date: string;
  schools: RegionalSchoolSummaryDto[];
  totals: {
    schools: number;
    students: number;
    sections: number;
    teachers: number;
    classes: number;
    teachersOnLeave: number;
    uncoveredClasses: number;
    schoolsWithUncoveredClasses: number;
    studentsAtRisk: number;
    schoolsBehindOnGrades: number;
    /** Promedio ponderado por alumnos de los centros que registran asistencia. */
    attendanceRate7d: number | null;
  };
}

export interface RegionalSchoolDetailDto {
  summary: RegionalSchoolSummaryDto;
  coverage: CoverageDto;
  sections: import("./academic").SectionDto[];
}
