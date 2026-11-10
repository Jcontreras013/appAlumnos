import { z } from "zod";
import { isIsoDate } from "./weeks";

// ───────────────────────────── Formatos de Honduras ─────────────────────────────

const digits = (value: string) => value.replace(/\D/g, "");

/** Número de identidad: 13 dígitos. Se acepta con guiones o espacios ("0801-2015-12345"). */
export const nationalIdSchema = z
  .string()
  .trim()
  .transform(digits)
  .pipe(z.string().regex(/^\d{13}$/, { error: "La identidad debe tener 13 dígitos" }));

export function formatNationalId(id: string | null | undefined): string {
  if (!id) return "—";
  const d = digits(id);
  return d.length === 13 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : id;
}

/** Teléfono hondureño de 8 dígitos; se acepta con +504, espacios o guiones. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => digits(v).replace(/^504(?=\d{8}$)/, ""))
  .pipe(z.string().regex(/^[2-9]\d{7}$/, { error: "El teléfono debe tener 8 dígitos" }));

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return phone.length === 8 ? `${phone.slice(0, 4)}-${phone.slice(4)}` : phone;
}

/** Campo opcional de formulario: "" o espacios cuentan como "no lo llenó". */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (v) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? undefined : v),
    schema.optional(),
  );
}

const isoDateSchema = z.string().refine(isIsoDate, { error: "Fecha inválida" });

/**
 * Fechas como las escribe una secretaria o las exporta Excel: "2015-03-21", "21/03/2015", "21-3-2015".
 * Devuelve AAAA-MM-DD o null si no se entiende (nunca adivina el formato mes/día).
 */
export function parseFlexibleDate(value: string): string | null {
  const v = value.trim();
  if (isIsoDate(v)) return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]?.padStart(2, "0")}-${m[1]?.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

// ───────────────────────────── Alumnos y responsables ─────────────────────────────

export const RELATIONSHIPS = ["madre", "padre", "tutor", "abuelo", "otro"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  madre: "Madre",
  padre: "Padre",
  tutor: "Tutor/a",
  abuelo: "Abuelo/a",
  otro: "Otro",
};

export const SEXES = ["F", "M"] as const;
export const SEX_LABELS: Record<(typeof SEXES)[number], string> = { F: "Femenino", M: "Masculino" };

const namePart = z.string().trim().min(2, { error: "Muy corto" }).max(80);

export const studentFieldsSchema = z.object({
  firstNames: namePart,
  lastNames: namePart,
  nationalId: optional(nationalIdSchema),
  birthDate: optional(isoDateSchema),
  sex: optional(z.enum(SEXES)),
  medicalNotes: optional(z.string().trim().max(1000)),
  notes: optional(z.string().trim().max(2000)),
});
export type StudentFields = z.infer<typeof studentFieldsSchema>;

export const guardianInputSchema = z
  .object({
    fullName: z.string().trim().min(3, { error: "Escribe el nombre completo" }).max(150),
    nationalId: optional(nationalIdSchema),
    phone: optional(phoneSchema),
    email: optional(
      z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.email({ error: "Correo inválido" })),
    ),
    relationship: z.enum(RELATIONSHIPS, { error: "Elige el parentesco" }),
    isPrimary: z.boolean().default(false),
  })
  .refine((g) => g.phone || g.email, {
    error: "Indica al menos un teléfono o un correo para contactarlo",
    path: ["phone"],
  });
export type GuardianInput = z.infer<typeof guardianInputSchema>;

export const createStudentInputSchema = studentFieldsSchema.extend({
  guardians: z
    .array(guardianInputSchema)
    .min(1, { error: "Agrega al menos un responsable" })
    .max(4)
    .refine((list) => list.filter((g) => g.isPrimary).length <= 1, {
      error: "Solo puede haber un responsable principal",
    }),
  /** Si viene, el alumno queda matriculado de una vez en esa sección (del año vigente). */
  sectionId: optional(z.uuid()),
});
export type CreateStudentInput = z.infer<typeof createStudentInputSchema>;

export const enrollInputSchema = z.object({
  studentId: z.uuid(),
  sectionId: z.uuid({ error: "Elige la sección" }),
});

export const withdrawInputSchema = z.object({
  withdrawnOn: isoDateSchema,
  reason: z.string().trim().min(3, { error: "Indica el motivo del retiro" }).max(500),
});

// ───────────────────────────── Importación desde Excel ─────────────────────────────

/** Columnas del archivo de importación. Los encabezados se reconocen sin importar tildes ni mayúsculas. */
export const IMPORT_COLUMNS = [
  { key: "nombres", label: "Nombres", required: true, aliases: ["nombre", "nombres_alumno"] },
  { key: "apellidos", label: "Apellidos", required: true, aliases: ["apellido", "apellidos_alumno"] },
  { key: "identidad", label: "Identidad", required: false, aliases: ["dni", "identidad_alumno"] },
  { key: "fecha_nacimiento", label: "Fecha de nacimiento", required: false, aliases: ["nacimiento"] },
  { key: "sexo", label: "Sexo", required: false, aliases: ["genero"] },
  { key: "grado", label: "Grado", required: true, aliases: ["curso"] },
  { key: "seccion", label: "Sección", required: true, aliases: ["seccion_alumno", "paralelo"] },
  { key: "responsable", label: "Responsable", required: true, aliases: ["encargado", "padre_o_madre"] },
  { key: "parentesco", label: "Parentesco", required: false, aliases: ["relacion"] },
  {
    key: "identidad_responsable",
    label: "Identidad del responsable",
    required: false,
    aliases: ["dni_responsable"],
  },
  { key: "telefono", label: "Teléfono", required: false, aliases: ["celular", "telefono_responsable"] },
  { key: "correo", label: "Correo", required: false, aliases: ["email", "correo_responsable"] },
  {
    key: "alergias",
    label: "Alergias o condiciones",
    required: false,
    aliases: ["condiciones", "notas_medicas"],
  },
] as const;
export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Encuentra qué columna del archivo corresponde a cada campo. Devuelve también las que faltan. */
export interface ImportColumn<K extends string = string> {
  key: K;
  label: string;
  required: boolean;
  aliases: readonly string[];
}

/** Ubica cada columna conocida en los encabezados del archivo (sin importar tildes ni mayúsculas). */
export function mapHeaders<K extends string>(
  columns: readonly ImportColumn<K>[],
  headers: string[],
): { mapping: Partial<Record<K, number>>; missing: string[] } {
  const normalized = headers.map(normalizeHeader);
  const mapping: Partial<Record<K, number>> = {};
  for (const column of columns) {
    // El nombre visible de la columna (el de la plantilla) también vale como encabezado.
    const candidates: string[] = [column.key, ...column.aliases, normalizeHeader(column.label)];
    const index = normalized.findIndex((h) => candidates.includes(h));
    if (index >= 0) mapping[column.key] = index;
  }
  const missing = columns.filter((c) => c.required && mapping[c.key] === undefined).map((c) => c.label);
  return { mapping, missing };
}

export function mapImportHeaders(headers: string[]): {
  mapping: Partial<Record<ImportColumnKey, number>>;
  missing: string[];
} {
  return mapHeaders(IMPORT_COLUMNS, headers);
}

export type ImportRow = Partial<Record<ImportColumnKey, string>>;

export const importInputSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1, { error: "El archivo no tiene filas" })
    .max(2000, { error: "Máximo 2,000 alumnos por archivo" }),
  dryRun: z.boolean(),
});

// ───────────────────────────── DTOs ─────────────────────────────

export interface GuardianDto {
  id: string;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  email: string | null;
}

export interface GuardianLinkDto extends GuardianDto {
  relationship: Relationship;
  isPrimary: boolean;
  /** Ya tiene cuenta en el portal de familias. */
  hasPortalAccess: boolean;
}

export interface EnrollmentDto {
  id: string;
  schoolYearId: string;
  schoolYearName: string;
  sectionId: string;
  sectionLabel: string;
  status: "activa" | "retirada";
  enrolledOn: string;
  withdrawnOn: string | null;
  withdrawReason: string | null;
}

export interface StudentListItemDto {
  id: string;
  firstNames: string;
  lastNames: string;
  nationalId: string | null;
  /** Matrícula del año vigente, si tiene. */
  enrollment: Pick<EnrollmentDto, "id" | "sectionId" | "sectionLabel" | "status"> | null;
  primaryGuardian: Pick<GuardianDto, "fullName" | "phone"> | null;
}

export interface StudentDetailDto {
  id: string;
  firstNames: string;
  lastNames: string;
  nationalId: string | null;
  birthDate: string | null;
  sex: "F" | "M" | null;
  medicalNotes: string | null;
  notes: string | null;
  guardians: GuardianLinkDto[];
  enrollments: EnrollmentDto[];
  /** Hermanos: otros alumnos que comparten algún responsable. */
  siblings: Array<{ id: string; fullName: string }>;
  createdAt: string;
}

export interface ImportRowResultDto {
  row: number;
  student: string;
  section: string | null;
  errors: string[];
}

export interface ImportResultDto {
  dryRun: boolean;
  total: number;
  valid: number;
  created: number;
  guardiansReused: number;
  rows: ImportRowResultDto[];
}
