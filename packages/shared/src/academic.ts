import { z } from "zod";
import { isIsoDate, isMonday, WEEKDAYS, type Weekday } from "./weeks";

// ───────────────────────────── Estructura académica ─────────────────────────────

const isoDateSchema = z.string().refine(isIsoDate, { error: "Fecha inválida (usa AAAA-MM-DD)" });
const nameSchema = (max = 80) => z.string().trim().min(1, { error: "Escribe un nombre" }).max(max);

export const schoolYearInputSchema = z
  .object({
    name: nameSchema(40),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  })
  .refine((v) => v.startsOn < v.endsOn, {
    error: "La fecha de fin debe ser posterior a la de inicio",
    path: ["endsOn"],
  });
export type SchoolYearInput = z.infer<typeof schoolYearInputSchema>;

export const gradeInputSchema = z.object({
  name: nameSchema(),
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});
export type GradeInput = z.infer<typeof gradeInputSchema>;

export const sectionInputSchema = z.object({
  schoolYearId: z.uuid({ error: "Elige el año lectivo" }),
  gradeId: z.uuid({ error: "Elige el grado" }),
  name: nameSchema(20),
  /** Cupo máximo. Vacío = sin límite. */
  capacity: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().int().min(1, { error: "El cupo debe ser al menos 1" }).max(200).nullable(),
  ),
});
export type SectionInput = z.infer<typeof sectionInputSchema>;

export const subjectInputSchema = z.object({ name: nameSchema() });
export type SubjectInput = z.infer<typeof subjectInputSchema>;

export const assignmentInputSchema = z.object({
  sectionId: z.uuid({ error: "Elige la sección" }),
  subjectId: z.uuid({ error: "Elige la materia" }),
  teacherUserId: z.uuid({ error: "Elige el docente" }),
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

// ───────────────────────────── Plantilla de planificación ─────────────────────────────

/**
 * Tipos de campo de la plantilla:
 * - texto: una línea ("Tema de la semana")
 * - parrafo: texto largo ("Contenidos")
 * - dias: un texto por día, de lunes a viernes ("Actividades por día")
 */
export const PLAN_FIELD_TYPES = ["texto", "parrafo", "dias"] as const;
export type PlanFieldType = (typeof PLAN_FIELD_TYPES)[number];

export const PLAN_FIELD_TYPE_LABELS: Record<PlanFieldType, string> = {
  texto: "Texto corto",
  parrafo: "Párrafo",
  dias: "Un texto por día (lunes a viernes)",
};

export const planFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, { error: "Clave inválida" }),
  label: z.string().trim().min(2, { error: "Escribe el nombre del campo" }).max(80),
  type: z.enum(PLAN_FIELD_TYPES),
  required: z.boolean(),
  help: z.string().trim().max(200).optional(),
});
export type PlanField = z.infer<typeof planFieldSchema>;

export const planTemplateInputSchema = z.object({
  fields: z
    .array(planFieldSchema)
    .min(1, { error: "La plantilla necesita al menos un campo" })
    .max(20, { error: "Máximo 20 campos" })
    .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
      error: "Hay dos campos con la misma clave",
    }),
  /** Días antes del lunes en que vence la entrega (3 = el viernes anterior). */
  deadlineDaysBefore: z.coerce.number().int().min(0).max(14),
});
export type PlanTemplateInput = z.infer<typeof planTemplateInputSchema>;

/** Plantilla por defecto, basada en los elementos que pide el Currículo Nacional Básico. */
export const DEFAULT_PLAN_TEMPLATE: PlanTemplateInput = {
  deadlineDaysBefore: 3,
  fields: [
    { key: "tema", label: "Tema de la semana", type: "texto", required: true },
    {
      key: "estandar",
      label: "Estándar / expectativa de logro",
      type: "parrafo",
      required: true,
      help: "Lo que el alumno debe lograr al terminar la semana.",
    },
    { key: "contenidos", label: "Contenidos", type: "parrafo", required: true },
    {
      key: "actividades",
      label: "Actividades por día",
      type: "dias",
      required: true,
      help: "Inicio, desarrollo y cierre de cada clase.",
    },
    { key: "recursos", label: "Recursos y materiales", type: "parrafo", required: false },
    { key: "evaluacion", label: "Evaluación", type: "parrafo", required: true },
    {
      key: "tareas",
      label: "Tareas para la casa",
      type: "parrafo",
      required: false,
      help: "Cuando se active el portal de padres, esto será lo que vean las familias.",
    },
  ],
};

/** Convierte una etiqueta en clave de campo: "Recursos y materiales" => "recursos_y_materiales". */
export function fieldKeyFromLabel(label: string): string {
  const key = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(key) ? key : `campo_${key}`.slice(0, 40);
}

// ───────────────────────────── Planificaciones ─────────────────────────────

export const PLAN_STATUSES = ["borrador", "enviada", "devuelta", "aprobada"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus | "sin_iniciar", string> = {
  sin_iniciar: "Sin iniciar",
  borrador: "Borrador",
  enviada: "En revisión",
  devuelta: "Devuelta con observaciones",
  aprobada: "Aprobada",
};

export type DaysValue = Record<Weekday, string>;
export type PlanContent = Record<string, string | DaysValue>;

export const weekStartSchema = z.string().refine(isMonday, { error: "La semana debe empezar en lunes" });

const dayValueSchema = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, z.string().max(5000).default("")])) as Record<
    Weekday,
    z.ZodDefault<z.ZodString>
  >,
);

/** Valida el contenido contra los campos de la plantilla y descarta claves que no existen en ella. */
export function parsePlanContent(
  fields: readonly PlanField[],
  raw: unknown,
): { content: PlanContent; errors: Record<string, string> } {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const content: PlanContent = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = source[field.key];
    if (field.type === "dias") {
      const parsed = dayValueSchema.safeParse(value ?? {});
      if (!parsed.success) errors[field.key] = "Valor inválido";
      else
        content[field.key] = Object.fromEntries(WEEKDAYS.map((d) => [d, parsed.data[d].trim()])) as DaysValue;
    } else {
      const parsed = z
        .string()
        .max(10_000)
        .safeParse(value ?? "");
      if (!parsed.success) errors[field.key] = "Texto demasiado largo";
      else content[field.key] = parsed.data.trim();
    }
  }
  return { content, errors };
}

/** Campos obligatorios sin llenar. En "dias" basta con un día (hay semanas con feriados). */
export function missingRequiredFields(fields: readonly PlanField[], content: PlanContent): PlanField[] {
  return fields.filter((field) => {
    if (!field.required) return false;
    const value = content[field.key];
    if (field.type === "dias") {
      return !value || typeof value === "string" || WEEKDAYS.every((d) => !value[d]);
    }
    return typeof value !== "string" || value.length === 0;
  });
}

export const savePlanInputSchema = z.object({
  content: z.record(z.string(), z.unknown()),
  /** Versión que se editó: si alguien guardó otra cosa mientras tanto, se avisa en vez de pisarla. */
  version: z.number().int().positive().optional(),
});
export type SavePlanInput = z.infer<typeof savePlanInputSchema>;

export const createPlanInputSchema = z.object({
  assignmentId: z.uuid(),
  weekStart: weekStartSchema,
  /** Si viene, se copia el contenido de esa planificación (del mismo docente). */
  copyFromPlanId: z.uuid().optional(),
});
export type CreatePlanInput = z.infer<typeof createPlanInputSchema>;

export const reviewPlanInputSchema = z
  .object({
    decision: z.enum(["aprobar", "devolver"]),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === "aprobar" || (v.comment && v.comment.length >= 5), {
    error: "Al devolver una planificación explica qué debe corregirse",
    path: ["comment"],
  });
export type ReviewPlanInput = z.infer<typeof reviewPlanInputSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

export interface SchoolYearDto {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export interface GradeDto {
  id: string;
  name: string;
  sortOrder: number;
}

export interface SectionDto {
  id: string;
  schoolYearId: string;
  gradeId: string;
  gradeName: string;
  name: string;
  /** "Primer grado A" */
  label: string;
  capacity: number | null;
  /** Alumnos con matrícula activa. */
  enrolledCount: number;
}

export interface SubjectDto {
  id: string;
  name: string;
}

export interface AssignmentDto {
  id: string;
  schoolYearId: string;
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  teacherName: string;
}

export interface PlanTemplateDto extends PlanTemplateInput {
  isDefault: boolean;
  updatedAt: string | null;
}

export interface LessonPlanDto {
  id: string;
  assignment: AssignmentDto;
  weekStart: string;
  status: PlanStatus;
  fields: PlanField[];
  content: PlanContent;
  version: number;
  deadline: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanHistoryDto {
  id: string;
  action: "creada" | "guardada" | "enviada" | "aprobada" | "devuelta";
  actorName: string;
  comment: string | null;
  version: number;
  createdAt: string;
}

export interface PlanDetailDto {
  plan: LessonPlanDto;
  history: PlanHistoryDto[];
  /** Quien la escribe (titular o sustituto) y solo mientras sea borrador o esté devuelta. */
  canEdit: boolean;
  /** Dirección o coordinación, cuando está en revisión. */
  canReview: boolean;
}

export interface PlanBoardRowDto {
  assignment: AssignmentDto;
  planId: string | null;
  status: PlanStatus | "sin_iniciar";
  submittedAt: string | null;
  /** No se ha enviado y ya pasó la fecha límite. */
  overdue: boolean;
}

export interface PlanBoardDto {
  weekStart: string;
  deadline: string;
  rows: PlanBoardRowDto[];
  totals: Record<PlanStatus | "sin_iniciar" | "atrasadas", number>;
}
