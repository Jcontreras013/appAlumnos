import type { Role } from "./roles";

/** Formas de las respuestas de la API, compartidas entre servicios y frontend. */

export interface SchoolDto {
  id: string;
  slug: string;
  name: string;
  rtn: string | null;
  active: boolean;
  createdAt: string;
}

export interface UserDto {
  id: string;
  schoolId: string | null;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
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

export interface MeResponseDto {
  user: UserDto;
  school: SchoolDto | null;
}

/** Formato de error uniforme de todos los servicios. */
export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
