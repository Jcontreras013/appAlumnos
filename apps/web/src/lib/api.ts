import "server-only";
import type { ApiErrorDto } from "@escolar/shared";

/** Error de un servicio, con el mensaje en español listo para mostrar al usuario. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Array<{ path: string; message: string }>,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type CallInit = Omit<RequestInit, "body"> & { token?: string; body?: unknown };

/** Llama a un microservicio desde el servidor de Next (BFF). El navegador nunca habla con ellos directo. */
export async function serviceCall<T>(baseUrl: string, path: string, init: CallInit = {}): Promise<T> {
  const { token, body, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...rest,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
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
  const data = (await response.json().catch(() => null)) as T | ApiErrorDto | null;
  if (!response.ok) {
    const error = (data as ApiErrorDto | null)?.error;
    const details = error?.details as { fields?: Array<{ path: string; message: string }> } | undefined;
    throw new ServiceError(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? "Ocurrió un error inesperado",
      details?.fields,
      error?.details,
    );
  }
  return data as T;
}
