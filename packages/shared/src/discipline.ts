import { z } from "zod";
import type { Role } from "./roles";
import { isIsoDate } from "./weeks";

/**
 * Disciplina: llamados de atención y medidas por faltas de conducta, de la más leve a la expulsión.
 * Cada registro dice qué pasó, qué medida se tomó y si se le avisó a la familia (solo entonces la
 * familia lo ve en su portal).
 */
export const DISCIPLINE_KINDS = [
  "llamado_verbal",
  "llamado_escrito",
  "citacion",
  "compromiso",
  "suspension",
  "expulsion",
] as const;
export type DisciplineKind = (typeof DISCIPLINE_KINDS)[number];
export const DISCIPLINE_LABELS: Record<DisciplineKind, string> = {
  llamado_verbal: "Llamado de atención verbal",
  llamado_escrito: "Llamado de atención por escrito",
  citacion: "Citación a la familia",
  compromiso: "Acta de compromiso",
  suspension: "Suspensión",
  expulsion: "Expulsión",
};

export const DISCIPLINE_SEVERITIES = ["leve", "grave", "muy_grave"] as const;
export type DisciplineSeverity = (typeof DISCIPLINE_SEVERITIES)[number];
export const SEVERITY_LABELS: Record<DisciplineSeverity, string> = {
  leve: "Falta leve",
  grave: "Falta grave",
  muy_grave: "Falta muy grave",
};

/** Qué medidas puede registrar cada cargo: la suspensión y la expulsión, solo la dirección. */
const KINDS_BY_ROLE: Partial<Record<Role, readonly DisciplineKind[]>> = {
  admin: DISCIPLINE_KINDS,
  coordinador: ["llamado_verbal", "llamado_escrito", "citacion", "compromiso"],
  docente: ["llamado_verbal", "llamado_escrito", "citacion"],
};

export function disciplineKindsFor(role: Role): readonly DisciplineKind[] {
  return KINDS_BY_ROLE[role] ?? [];
}

const isoDate = z.string().refine(isIsoDate, { error: "Fecha inválida" });
const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), isoDate.optional());
const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(1000, { error: "Máximo 1000 caracteres" }).optional(),
);
/** La casilla de un formulario llega como "on"; por la API, como booleano. */
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

export const disciplineInputSchema = z
  .object({
    kind: z.enum(DISCIPLINE_KINDS, { error: "Elige la medida" }),
    severity: z.enum(DISCIPLINE_SEVERITIES, { error: "Elige qué tan grave fue" }),
    date: isoDate,
    description: z
      .string({ error: "Escribe qué pasó" })
      .trim()
      .min(3, { error: "Escribe qué pasó" })
      .max(1000, { error: "Máximo 1000 caracteres" }),
    measure: optionalText,
    suspensionFrom: optionalDate,
    suspensionTo: optionalDate,
    notifyFamily: checkbox,
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "suspension") return;
    if (!v.suspensionFrom)
      ctx.addIssue({ code: "custom", path: ["suspensionFrom"], message: "Escribe desde cuándo" });
    if (!v.suspensionTo)
      ctx.addIssue({ code: "custom", path: ["suspensionTo"], message: "Escribe hasta cuándo" });
    if (v.suspensionFrom && v.suspensionTo && v.suspensionTo < v.suspensionFrom)
      ctx.addIssue({ code: "custom", path: ["suspensionTo"], message: "Termina antes de empezar" });
    if (v.suspensionFrom && v.suspensionFrom < v.date)
      ctx.addIssue({
        code: "custom",
        path: ["suspensionFrom"],
        message: "No puede empezar antes de la falta",
      });
  })
  .transform((v) =>
    v.kind === "suspension" ? v : { ...v, suspensionFrom: undefined, suspensionTo: undefined },
  );
export type DisciplineInput = z.infer<typeof disciplineInputSchema>;

export interface DisciplineDto {
  id: string;
  studentId: string;
  studentName: string;
  /** Sección del año vigente (también si ya se retiró), o null. */
  sectionLabel: string | null;
  kind: DisciplineKind;
  severity: DisciplineSeverity;
  date: string;
  description: string;
  measure: string | null;
  suspensionFrom: string | null;
  suspensionTo: string | null;
  notifyFamily: boolean;
  authorName: string;
  createdAt: string;
  /** Quien lo registró, o la dirección, lo puede borrar si se equivocó. */
  canDelete: boolean;
}

/** Lo que la familia ve: solo los registros que se le avisaron, sin quién los anotó. */
export interface FamilyDisciplineDto {
  id: string;
  kind: DisciplineKind;
  severity: DisciplineSeverity;
  date: string;
  description: string;
  measure: string | null;
  suspensionFrom: string | null;
  suspensionTo: string | null;
}

export interface DisciplineStudentOption {
  id: string;
  name: string;
  sectionLabel: string;
}

/** Lo que lleva el acta impresa: el registro, la identidad del alumno y su responsable principal. */
export interface DisciplineActaDto {
  record: DisciplineDto;
  nationalId: string | null;
  guardianName: string | null;
}

/** Título del acta impresa según la medida. */
export const ACTA_TITLES: Record<DisciplineKind, string> = {
  llamado_verbal: "Constancia de llamado de atención verbal",
  llamado_escrito: "Llamado de atención por escrito",
  citacion: "Citación a la familia",
  compromiso: "Acta de compromiso",
  suspension: "Notificación de suspensión",
  expulsion: "Notificación de expulsión",
};

/** La página de disciplina: a quién puede anotar quien entra, lo reciente y las suspensiones vigentes. */
export interface DisciplineOverviewDto {
  kinds: DisciplineKind[];
  students: DisciplineStudentOption[];
  recent: DisciplineDto[];
  activeSuspensions: DisciplineDto[];
}

/** ¿Está suspendido hoy? */
export function isSuspendedOn(
  d: Pick<DisciplineDto, "kind" | "suspensionFrom" | "suspensionTo">,
  day: string,
) {
  return (
    d.kind === "suspension" &&
    !!d.suspensionFrom &&
    !!d.suspensionTo &&
    d.suspensionFrom <= day &&
    day <= d.suspensionTo
  );
}
