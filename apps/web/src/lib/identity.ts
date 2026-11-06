import "server-only";
import type {
  ApiErrorDto,
  CreateSchoolInput,
  CreateUserInput,
  LoginResponseDto,
  MeResponseDto,
  SchoolDto,
  TokenPairDto,
  UserDto,
} from "@escolar/shared";
import { identityUrl } from "./config";

/** Error de un servicio, con el mensaje en español listo para mostrar al usuario. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${identityUrl()}${path}`, {
      ...rest,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-request-id": crypto.randomUUID(),
      },
    });
  } catch {
    throw new ServiceError(
      503,
      "service_unavailable",
      "No se pudo conectar con el servidor. Intenta de nuevo.",
    );
  }

  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as T | ApiErrorDto | null;
  if (!response.ok) {
    const error = (body as ApiErrorDto | null)?.error;
    const details = error?.details as { fields?: Array<{ path: string; message: string }> } | undefined;
    throw new ServiceError(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? "Ocurrió un error inesperado",
      details?.fields,
    );
  }
  return body as T;
}

const json = (data: unknown) => JSON.stringify(data);

export const identity = {
  login: (email: string, password: string) =>
    call<LoginResponseDto>("/auth/login", { method: "POST", body: json({ email, password }) }),
  refresh: (refreshToken: string) =>
    call<TokenPairDto>("/auth/refresh", { method: "POST", body: json({ refreshToken }) }),
  logout: (refreshToken: string) =>
    call<void>("/auth/logout", { method: "POST", body: json({ refreshToken }) }),
  me: (token: string) => call<MeResponseDto>("/me", { token }),

  listUsers: (token: string) => call<UserDto[]>("/users", { token }),
  createUser: (token: string, input: CreateUserInput) =>
    call<UserDto>("/users", { method: "POST", token, body: json(input) }),
  setUserActive: (token: string, id: string, active: boolean) =>
    call<UserDto>(`/users/${id}/status`, { method: "POST", token, body: json({ active }) }),

  listSchools: (token: string) => call<SchoolDto[]>("/schools", { token }),
  createSchool: (token: string, input: CreateSchoolInput) =>
    call<{ school: SchoolDto; admin: UserDto }>("/schools", { method: "POST", token, body: json(input) }),
  setSchoolActive: (token: string, id: string, active: boolean) =>
    call<SchoolDto>(`/schools/${id}/status`, { method: "POST", token, body: json({ active }) }),
};
