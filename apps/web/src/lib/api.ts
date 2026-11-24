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

export type CallInit = Omit<RequestInit, "body"> & {
  token?: string;
  body?: unknown;
  /** Cuánto esperar la respuesta (15 s por defecto; el asistente de planificación necesita más). */
  timeoutMs?: number;
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Una consulta (GET) que no llegó por un corte de red, como cuando una tarea del servicio se está
 * reemplazando en un despliegue, se reintenta una vez sin que el usuario lo note. Las escrituras no
 * se reintentan aquí (podrían aplicarse dos veces) y tampoco lo que tardó demasiado (reintentarlo
 * solo cargaría más a un servicio que ya va lento).
 */
export function shouldRetry(method: string | undefined, err: unknown, attempt: number): boolean {
  const reading = !method || method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  const timedOut = err instanceof DOMException && err.name === "TimeoutError";
  return reading && !timedOut && attempt === 0;
}

/** Llama a un microservicio desde el servidor de Next (BFF). El navegador nunca habla con ellos directo. */
export async function serviceCall<T>(baseUrl: string, path: string, init: CallInit = {}): Promise<T> {
  const { token, body, timeoutMs = 15_000, ...rest } = init;
  const requestId = crypto.randomUUID();
  let response: Response | undefined;
  for (let attempt = 0; !response; attempt++) {
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...rest,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "x-request-id": requestId,
        },
      });
    } catch (err) {
      if (shouldRetry(rest.method, err, attempt)) {
        await sleep(250);
        continue;
      }
      throw new ServiceError(
        503,
        "service_unavailable",
        "No se pudo conectar con el servidor. Intenta de nuevo.",
      );
    }
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
