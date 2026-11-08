import { ApiError } from "@escolar/service-kit";
import type { UserDto } from "@escolar/shared";

/**
 * Consultas a identity. Se reenvía el token del usuario que hace la petición ("token relay"):
 * identity aplica sus propios permisos y su propio filtro por colegio, así academic nunca puede
 * ver un usuario que la persona no podría ver por sí misma.
 */
export interface IdentityClient {
  getUser(bearerToken: string, userId: string): Promise<UserDto | null>;
}

export function httpIdentityClient(baseUrl: string): IdentityClient {
  return {
    async getUser(bearerToken, userId) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/users/${userId}`, {
          headers: { authorization: `Bearer ${bearerToken}` },
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        throw new ApiError(502, "identity_unavailable", "No se pudo validar el usuario. Intenta de nuevo.");
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new ApiError(502, "identity_error", "No se pudo validar el usuario. Intenta de nuevo.");
      }
      return (await response.json()) as UserDto;
    },
  };
}
