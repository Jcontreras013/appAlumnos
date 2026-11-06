import type { ApiErrorDto } from "@escolar/shared";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type z } from "zod";

/** Error de negocio con código estable. El `message` se muestra al usuario final, en español. */
export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Sesión inválida o expirada") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "No tienes permiso para esta acción") =>
  new ApiError(403, "forbidden", message);
export const notFound = (message = "No encontrado") => new ApiError(404, "not_found", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

/** Valida `data` con un esquema Zod; si falla, lanza un 400 con el detalle de cada campo. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}

function validationError(error: ZodError): ApiError {
  const fields = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  return new ApiError(400, "validation_error", fields[0]?.message ?? "Datos inválidos", { fields });
}

/** Postgres: violación de restricción UNIQUE. Drizzle envuelve el error del driver en `cause`. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const pg = current as { code?: string; constraint?: string };
    if (pg.code === "23505") {
      return constraint === undefined || pg.constraint === constraint;
    }
  }
  return false;
}

function body(code: string, message: string, details?: unknown): ApiErrorDto {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) {
    if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
    return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
  }
  if (error instanceof ZodError) {
    const apiError = validationError(error);
    return reply.status(400).send(body(apiError.code, apiError.message, apiError.details));
  }
  const statusCode = (error as FastifyError).statusCode;
  if (statusCode && statusCode < 500) {
    const code = statusCode === 429 ? "rate_limited" : ((error as FastifyError).code ?? "bad_request");
    const message =
      statusCode === 429 ? "Demasiados intentos. Espera un momento e inténtalo de nuevo." : error.message;
    return reply.status(statusCode).send(body(code, message));
  }
  // Errores inesperados: se registran completos pero al cliente solo le llega un mensaje genérico
  // con el id de la petición, para poder rastrearlo en los logs (CloudWatch) sin filtrar detalles.
  request.log.error({ err: error }, "Error no controlado");
  return reply
    .status(500)
    .send(body("internal_error", `Ocurrió un error inesperado. Referencia: ${request.id}`));
}
