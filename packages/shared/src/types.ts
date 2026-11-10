import type { Role } from "./roles";

/** Formas de las respuestas de la API, compartidas entre servicios y frontend. */

export const SCHOOL_SECTORS = ["publico", "privado"] as const;
export type SchoolSector = (typeof SCHOOL_SECTORS)[number];

export interface SchoolDto {
  id: string;
  slug: string;
  name: string;
  rtn: string | null;
  /** Código del centro educativo (el mismo del SACE en escuelas públicas). */
  code: string | null;
  sector: SchoolSector;
  districtId: string | null;
  active: boolean;
  /** Versión del logo (marca de tiempo) o null si el colegio no tiene logo. */
  logoVersion: number | null;
  createdAt: string;
}

export interface UserDto {
  id: string;
  schoolId: string | null;
  name: string;
  /** Las cuentas de familias pueden no tener correo (entran con su identidad). */
  email: string | null;
  nationalId?: string | null;
  /** Entró con una contraseña temporal: debe cambiarla antes de usar el panel. */
  mustChangePassword?: boolean;
  /** Rol en el centro o ámbito desde el que se consulta. */
  role: Role;
  /** Todos sus roles activos en ese centro (solo en la consulta individual). */
  roles?: Role[];
  active: boolean;
  createdAt: string;
}

/** Cuenta del portal de familias recién creada (o ya existente, enlazada a este centro). */
export interface FamilyAccountDto {
  userId: string;
  /** Con qué entra: el correo o la identidad con guiones. */
  login: string;
  /** Solo si se creó la cuenta (o se restableció la contraseña); se muestra una vez para entregarla. */
  temporaryPassword: string | null;
  linkedExisting: boolean;
}

export interface CreatedUserDto extends UserDto {
  /** La persona ya tenía cuenta (p. ej. trabaja en otro centro): se le agregó el acceso a este. */
  linkedExisting: boolean;
}

export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
  /** Segundos de vida del access token. */
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface LoginResponseDto extends TokenPairDto {
  user: UserDto;
}

/** Un acceso de la persona: su rol en un centro, distrito o departamento. */
export interface MembershipDto {
  id: string;
  role: Role;
  scopeType: "plataforma" | "departamento" | "distrito" | "centro";
  scopeId: string | null;
  /** Nombre del centro, distrito o departamento ("Plataforma" para superadmin). */
  scopeName: string;
  schoolLogoVersion: number | null;
  active: boolean;
}

export interface MeResponseDto {
  /** Rol y centro de la sesión actual. */
  user: UserDto;
  school: SchoolDto | null;
  current: MembershipDto;
  /** Todos los accesos activos de la persona (para cambiar de centro sin volver a iniciar sesión). */
  memberships: MembershipDto[];
}

export interface DistrictDto {
  id: string;
  departmentId: string;
  name: string;
}

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  districts: DistrictDto[];
}

/** Centro educativo visto desde la jerarquía (tablero departamental o distrital). */
export interface ScopedSchoolDto extends SchoolDto {
  districtName: string | null;
}

/** Formato de error uniforme de todos los servicios. */
export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
