import { z } from "zod";
import { addDays, isIsoDate } from "./weeks";

/*
 * Conducta: incidentes que reporta el personal y las medidas que decide el centro. Las categorías y
 * medidas son las más comunes; cada centro las aplica según su reglamento interno. La plataforma no
 * decide sanciones: registra lo que decide la dirección o la coordinación y deja constancia.
 */

export const CONDUCT_SEVERITIES = ["leve", "grave", "muy_grave"] as const;
export type ConductSeverity = (typeof CONDUCT_SEVERITIES)[number];
export const CONDUCT_SEVERITY_LABELS: Record<ConductSeverity, string> = {
  leve: "Leve",
  grave: "Grave",
  muy_grave: "Muy grave",
};

export const CONDUCT_CATEGORIES = [
  "irrespeto",
  "agresion",
  "acoso",
  "dano",
  "fraude",
  "fuga",
  "objetos",
  "otra",
] as const;
export type ConductCategory = (typeof CONDUCT_CATEGORIES)[number];
export const CONDUCT_CATEGORY_LABELS: Record<ConductCategory, string> = {
  irrespeto: "Irrespeto a compañeros o docentes",
  agresion: "Agresión física o verbal",
  acoso: "Acoso o intimidación",
  dano: "Daño a bienes del centro o de otros",
  fraude: "Copia o fraude en evaluaciones",
  fuga: "Fuga o ausencia sin permiso",
  objetos: "Objetos prohibidos o uso indebido del celular",
  otra: "Otra",
};

export const CONDUCT_MEASURES = [
  "llamado_atencion",
  "citacion_familia",
  "compromiso",
  "suspension",
  "expulsion",
] as const;
export type ConductMeasureKind = (typeof CONDUCT_MEASURES)[number];
export const CONDUCT_MEASURE_LABELS: Record<ConductMeasureKind, string> = {
  llamado_atencion: "Llamado de atención",
  citacion_familia: "Citación a la familia",
  compromiso: "Compromiso de conducta",
  suspension: "Suspensión",
  expulsion: "Expulsión",
};

/** Medidas que solo decide la dirección del centro (la coordinación registra las demás). */
export const DIRECTOR_ONLY_MEASURES: readonly ConductMeasureKind[] = ["suspension", "expulsion"];

/** Una suspensión dura como máximo esto (días seguidos, contando el primero). */
export const MAX_SUSPENSION_DAYS = 30;

const isoDate = z.string().refine(isIsoDate, { error: "Fecha inválida" });

export const incidentInputSchema = z.object({
  studentId: z.uuid({ error: "Elige al alumno" }),
  date: isoDate,
  severity: z.enum(CONDUCT_SEVERITIES, { error: "Elige la gravedad" }),
  category: z.enum(CONDUCT_CATEGORIES, { error: "Elige el tipo de falta" }),
  description: z
    .string({ error: "Describe qué pasó" })
    .trim()
    .min(10, { error: "Describe qué pasó (al menos 10 caracteres)" })
    .max(2000, { error: "Máximo 2000 caracteres" }),
});
export type IncidentInput = z.infer<typeof incidentInputSchema>;

const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

export const measureInputSchema = z
  .object({
    kind: z.enum(CONDUCT_MEASURES, { error: "Elige la medida" }),
    startsOn: isoDate,
    /** Último día de la suspensión. Solo para suspensiones. */
    endsOn: z.preprocess(blankToUndefined, isoDate.optional()),
    /** Lo que se le explica a la familia (la ve en su portal). */
    notes: z
      .string({ error: "Escribe la nota para la familia" })
      .trim()
      .min(3, { error: "Escribe la nota para la familia" })
      .max(1000, { error: "Máximo 1000 caracteres" }),
  })
  .superRefine((m, ctx) => {
    if (m.kind !== "suspension") return;
    if (!m.endsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "Indica el último día de la suspensión" });
    } else if (m.endsOn < m.startsOn) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: "Termina antes de empezar" });
    } else if (m.endsOn > addDays(m.startsOn, MAX_SUSPENSION_DAYS - 1)) {
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: `Una suspensión dura como máximo ${MAX_SUSPENSION_DAYS} días`,
      });
    }
  })
  .transform((m) => ({ ...m, endsOn: m.kind === "suspension" ? (m.endsOn ?? null) : null }));
export type MeasureInput = z.infer<typeof measureInputSchema>;

export interface ConductMeasureDto {
  id: string;
  incidentId: string;
  kind: ConductMeasureKind;
  startsOn: string;
  /** Último día (solo suspensiones). */
  endsOn: string | null;
  notes: string;
  decidedByName: string;
  createdAt: string;
  /** Anulada por error (queda en el historial). */
  cancelledAt: string | null;
}

export interface ConductIncidentDto {
  id: string;
  studentId: string;
  studentName: string;
  sectionLabel: string | null;
  date: string;
  severity: ConductSeverity;
  category: ConductCategory;
  description: string;
  reportedByName: string;
  createdAt: string;
  measures: ConductMeasureDto[];
  /** Quien lo reportó o la dirección lo pueden borrar mientras no tenga medidas. */
  canDelete: boolean;
}

export interface ConductOverviewDto {
  incidents: ConductIncidentDto[];
  totals: {
    /** Incidentes de los últimos 30 días. */
    last30Days: number;
    /** Graves y muy graves del año lectivo. */
    serious: number;
    /** Suspensiones que siguen vigentes hoy. */
    activeSuspensions: number;
    expulsions: number;
  };
  /** Qué puede hacer quien consulta. */
  can: { report: boolean; measure: boolean; suspendOrExpel: boolean };
}

/** Un alumno al que quien consulta le puede reportar un incidente. */
export interface ConductStudentOptionDto {
  studentId: string;
  name: string;
  sectionId: string;
  sectionLabel: string;
}

/**
 * Lo que la familia (y la departamental) ve de la conducta: las medidas, con el tipo de falta y la
 * gravedad, sin la descripción del incidente (puede nombrar a otros alumnos).
 */
export interface ConductRecordDto {
  measureId: string;
  incidentDate: string;
  severity: ConductSeverity;
  category: ConductCategory;
  kind: ConductMeasureKind;
  startsOn: string;
  endsOn: string | null;
  notes: string;
}

/** ¿La suspensión está vigente ese día? */
export const suspensionActive = (
  m: Pick<ConductMeasureDto, "kind" | "startsOn" | "endsOn" | "cancelledAt">,
  date: string,
) => m.kind === "suspension" && !m.cancelledAt && m.startsOn <= date && (m.endsOn ?? m.startsOn) >= date;
