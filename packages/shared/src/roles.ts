/**
 * Roles de la plataforma. Una persona puede tener varios (membresías): por ejemplo, docente en una
 * escuela por la mañana y en otra por la tarde. Cada sesión trabaja con uno a la vez.
 *
 * - superadmin: equipo de la plataforma.
 * - director_departamental / director_distrital: ven todos los centros de su departamento o distrito.
 * - El resto pertenece a un centro educativo (tenant).
 */
export const ROLES = [
  "superadmin",
  "director_departamental",
  "director_distrital",
  "admin",
  "coordinador",
  "finanzas",
  "secretaria",
  "docente",
  "padre",
  "estudiante",
] as const;

export type Role = (typeof ROLES)[number];

export const SCHOOL_ROLES = [
  "admin",
  "coordinador",
  "finanzas",
  "secretaria",
  "docente",
  "padre",
  "estudiante",
] as const satisfies readonly Role[];
export type SchoolRole = (typeof SCHOOL_ROLES)[number];

export const REGIONAL_ROLES = [
  "director_departamental",
  "director_distrital",
] as const satisfies readonly Role[];
export type RegionalRole = (typeof REGIONAL_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadmin de la plataforma",
  director_departamental: "Dirección departamental",
  director_distrital: "Dirección distrital",
  admin: "Dirección del centro",
  coordinador: "Coordinación académica",
  finanzas: "Finanzas",
  secretaria: "Secretaría",
  docente: "Docente",
  padre: "Familia",
  estudiante: "Alumno",
};

/**
 * Cuentas del portal, no del personal: las familias y los alumnos. Las crea la secretaría o la
 * dirección desde la ficha del alumno; no aparecen en «Personal y usuarios».
 */
export const PORTAL_ROLES = ["padre", "estudiante"] as const satisfies readonly SchoolRole[];
export type PortalRole = (typeof PORTAL_ROLES)[number];

export function isPortalRole(role: Role): role is PortalRole {
  return (PORTAL_ROLES as readonly string[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isSchoolRole(role: Role): role is SchoolRole {
  return (SCHOOL_ROLES as readonly string[]).includes(role);
}

export function isRegionalRole(role: Role): role is RegionalRole {
  return (REGIONAL_ROLES as readonly string[]).includes(role);
}

/**
 * Roles que ven datos de muchos centros: deben usar verificación en dos pasos (2FA). La primera vez
 * entran con la contraseña y el panel les pide activarla antes de seguir.
 */
export const MFA_ROLES = [
  "superadmin",
  "director_departamental",
  "director_distrital",
] as const satisfies readonly Role[];

export const requiresMfa = (roles: readonly Role[]) =>
  roles.some((r) => (MFA_ROLES as readonly Role[]).includes(r));
