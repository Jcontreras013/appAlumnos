import { ApiError } from "@escolar/service-kit";
import type { ScopedSchoolDto, UserDto } from "@escolar/shared";
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

export function httpIdentityClient(baseUrl: string): IdentityClient {
  return {
    getUser: (bearerToken, userId) => get<UserDto>(`${baseUrl}/users/${userId}`, bearerToken),
    getScopeSchools: async (bearerToken) =>
      (await get<ScopedSchoolDto[]>(`${baseUrl}/scope/schools`, bearerToken)) ?? [],
  };
}
