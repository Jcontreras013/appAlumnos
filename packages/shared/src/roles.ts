/**
 * Roles de la plataforma.
 * - superadmin: equipo de la plataforma; no pertenece a ningún colegio.
 * - El resto siempre pertenece a exactamente un colegio (tenant).
 */
export const ROLES = ["superadmin", "admin", "finanzas", "secretaria", "docente", "padre"] as const;

export type Role = (typeof ROLES)[number];

export const SCHOOL_ROLES = [
  "admin",
  "finanzas",
  "secretaria",
  "docente",
  "padre",
] as const satisfies readonly Role[];

export type SchoolRole = (typeof SCHOOL_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadmin de la plataforma",
  admin: "Administrador del colegio",
  finanzas: "Finanzas",
  secretaria: "Secretaría",
  docente: "Docente",
  padre: "Padre de familia",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
