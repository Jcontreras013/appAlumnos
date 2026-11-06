import "server-only";
import type { MeResponseDto, Role } from "@escolar/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { identity, ServiceError } from "./identity";
import { ACCESS_COOKIE } from "./session-cookies";

export interface Session extends MeResponseDto {
  accessToken: string;
}

/**
 * Capa de acceso a datos: la única puerta para saber quién es el usuario.
 * El proxy ya refrescó el token si hacía falta; aquí se valida contra el servicio de identidad
 * (que es quien sabe si el usuario sigue activo). `cache` evita repetir la llamada en un mismo render.
 */
export const getSession = cache(async (): Promise<Session> => {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!accessToken) redirect("/login");
  try {
    const me = await identity.me(accessToken);
    return { ...me, accessToken };
  } catch (err) {
    if (err instanceof ServiceError && err.status === 401) redirect("/login?expirada=1");
    throw err;
  }
});

/** Exige uno de los roles; si no, manda al inicio del panel. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!roles.includes(session.user.role)) redirect("/panel");
  return session;
}
