import { z } from "zod";
import type { ImportColumn } from "./enrollment";
import type { Role } from "./roles";

/*
 * Puesta en marcha de una región: la departamental carga sus centros (con el director de cada uno)
 * y cada dirección carga a su personal desde un Excel. Cada cuenta nueva recibe una contraseña
 * temporal que se entrega en papel y se cambia al primer ingreso.
 */

// ───────────────────────────── Personal de un centro ─────────────────────────────

export const STAFF_IMPORT_ROLES = ["docente", "coordinador", "secretaria"] as const;
export type StaffImportRole = (typeof STAFF_IMPORT_ROLES)[number];

/** Cómo se escribe el cargo en los listados de las escuelas. Vacío = docente. */
const ROLE_WORDS: Record<string, StaffImportRole> = {
  docente: "docente",
  maestro: "docente",
  maestra: "docente",
  profesor: "docente",
  profesora: "docente",
  coordinador: "coordinador",
  coordinadora: "coordinador",
  coordinacion: "coordinador",
  secretaria: "secretaria",
  secretario: "secretaria",
};

export function staffRoleFrom(value: string | undefined): StaffImportRole | null {
  const word = (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!word) return "docente";
  return ROLE_WORDS[word] ?? null;
}

export const STAFF_IMPORT_COLUMNS = [
  {
    key: "nombre",
    label: "Nombre completo",
    required: true,
    aliases: ["nombres", "nombre_completo", "docente"],
  },
  { key: "identidad", label: "Identidad", required: false, aliases: ["dni", "numero_de_identidad"] },
  { key: "correo", label: "Correo", required: false, aliases: ["email", "correo_electronico"] },
  { key: "rol", label: "Cargo", required: false, aliases: ["cargo", "puesto"] },
] as const satisfies readonly ImportColumn[];

export const SCHOOL_IMPORT_COLUMNS = [
  {
    key: "centro",
    label: "Nombre del centro",
    required: true,
    aliases: ["nombre_del_centro", "escuela", "nombre"],
  },
  { key: "codigo", label: "Código del centro", required: false, aliases: ["codigo", "codigo_sace"] },
  { key: "distrito", label: "Distrito", required: true, aliases: ["municipio"] },
  {
    key: "director",
    label: "Director o directora",
    required: true,
    aliases: ["directora", "nombre_del_director"],
  },
  {
    key: "identidad_director",
    label: "Identidad del director",
    required: false,
    aliases: ["dni_director", "identidad"],
  },
  { key: "correo_director", label: "Correo del director", required: false, aliases: ["correo", "email"] },
] as const satisfies readonly ImportColumn[];

const rowsSchema = z
  .array(z.record(z.string(), z.string()))
  .min(1, { error: "El archivo no tiene filas" })
  .max(500, { error: "Máximo 500 filas por archivo" });

export const staffImportInputSchema = z.object({ rows: rowsSchema, dryRun: z.boolean() });
export const schoolImportInputSchema = z.object({
  rows: rowsSchema,
  dryRun: z.boolean(),
  /** Solo para el equipo de la plataforma; la departamental usa su propio departamento. */
  departmentId: z.uuid().optional(),
});

/**
 * nuevo = se crea la cuenta (con contraseña temporal); existente = ya tenía cuenta en la plataforma
 * (p. ej. trabaja en otra escuela) y solo se le agrega el acceso; ya_tiene_acceso = no hay nada que hacer.
 */
export type AccountImportStatus = "nuevo" | "existente" | "ya_tiene_acceso" | "error";

export interface StaffImportRowDto {
  row: number;
  name: string;
  login: string | null;
  role: Role | null;
  status: AccountImportStatus;
  errors: string[];
  /** Solo al confirmar y solo para cuentas nuevas. */
  temporaryPassword: string | null;
}

export interface SchoolImportRowDto {
  row: number;
  schoolName: string;
  code: string | null;
  districtName: string;
  directorName: string;
  directorLogin: string | null;
  status: AccountImportStatus;
  errors: string[];
  temporaryPassword: string | null;
}

export interface ImportSummaryDto<R> {
  dryRun: boolean;
  rows: R[];
  valid: number;
  invalid: number;
  /** Cuentas nuevas (al confirmar). */
  created: number;
}
