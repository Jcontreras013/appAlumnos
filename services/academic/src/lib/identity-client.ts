import { ApiError } from "@escolar/service-kit";
import type { FamilyAccountDto, FamilyAccountInput, ScopedSchoolDto, UserDto } from "@escolar/shared";
import type { FastifyRequest } from "fastify";

/**
 * Consultas a identity. Se reenvía el token del usuario que hace la petición ("token relay"):
 * identity aplica sus propios permisos y su propio filtro por centro o región, así academic nunca
 * puede ver algo que la persona no podría ver por sí misma.
 */
export interface IdentityClient {
  getUser(bearerToken: string, userId: string): Promise<UserDto | null>;
  /** Centros que la sesión puede ver (todo el departamento, el distrito o su propio centro). */
  getScopeSchools(bearerToken: string): Promise<ScopedSchoolDto[]>;
  /** Cuenta del portal de familias (la crea o enlaza identity con los permisos de quien pide). */
  createFamilyAccount(bearerToken: string, input: FamilyAccountInput): Promise<FamilyAccountDto>;
  resetFamilyPassword(bearerToken: string, userId: string): Promise<FamilyAccountDto>;
  revokeFamilyAccount(bearerToken: string, userId: string): Promise<void>;
}

export const bearerOf = (request: FastifyRequest) =>
  (request.headers.authorization ?? "").slice("Bearer ".length);

async function get<T>(url: string, bearerToken: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new ApiError(
      502,
      "identity_unavailable",
      "No se pudo consultar el servicio de identidad. Intenta de nuevo.",
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(
      502,
      "identity_error",
      "No se pudo consultar el servicio de identidad. Intenta de nuevo.",
    );
  }
  return (await response.json()) as T;
}

/** POST/DELETE a identity: sus errores de validación o permisos llegan tal cual al usuario. */
async function send<T>(
  url: string,
  bearerToken: string,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${bearerToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(
      502,
      "identity_unavailable",
      "No se pudo consultar el servicio de identidad. Intenta de nuevo.",
    );
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const error = data && "error" in data ? data.error : undefined;
    if (response.status >= 400 && response.status < 500 && error?.message) {
      throw new ApiError(response.status, error.code ?? "identity_error", error.message);
    }
    throw new ApiError(
      502,
      "identity_error",
      "No se pudo consultar el servicio de identidad. Intenta de nuevo.",
    );
  }
  return data as T;
}

export function httpIdentityClient(baseUrl: string): IdentityClient {
  return {
    getUser: (bearerToken, userId) => get<UserDto>(`${baseUrl}/users/${userId}`, bearerToken),
    getScopeSchools: async (bearerToken) =>
      (await get<ScopedSchoolDto[]>(`${baseUrl}/scope/schools`, bearerToken)) ?? [],
    createFamilyAccount: (bearerToken, input) =>
      send<FamilyAccountDto>(`${baseUrl}/family-accounts`, bearerToken, "POST", input),
    resetFamilyPassword: (bearerToken, userId) =>
      send<FamilyAccountDto>(`${baseUrl}/family-accounts/${userId}/reset-password`, bearerToken, "POST"),
    revokeFamilyAccount: (bearerToken, userId) =>
      send<void>(`${baseUrl}/family-accounts/${userId}`, bearerToken, "DELETE"),
  };
}
