import { randomUUID } from "node:crypto";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { errorHandler } from "./errors";

export interface CreateServiceOptions {
  /** Nombre del servicio; aparece en cada línea de log y en /health. */
  name: string;
  logger?: FastifyServerOptions["logger"];
  /** Comprobación de dependencias para /health/ready (por ejemplo, `select 1` a la base). */
  readiness?: () => Promise<void>;
}

/** Más que los 5 min que el proxy de Service Connect mantiene una conexión sin uso. */
export const KEEP_ALIVE_MS = 310_000;

/** Campos que nunca deben llegar a los logs. */
const REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.passwordHash",
  "*.currentPassword",
  "*.newPassword",
  "*.temporaryPassword",
  "*.refreshToken",
  "*.accessToken",
];

export function defaultLogger(name: string): FastifyServerOptions["logger"] {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: name },
    redact: { paths: REDACT, censor: "[oculto]" },
    ...(process.env.LOG_PRETTY === "true" ? { transport: { target: "pino-pretty" } } : {}),
  };
}

/**
 * Crea un servidor Fastify con la configuración común a todos los servicios:
 * headers de seguridad, id de petición propagable, logs JSON con datos sensibles ocultos,
 * formato de error uniforme y endpoints de salud para el balanceador de carga.
 */
export async function createService(options: CreateServiceOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? defaultLogger(options.name),
    trustProxy: true,
    // Si el gateway / otro servicio ya trae un id de petición, se reutiliza para seguir la traza.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    // El proxy de Service Connect deja abiertas las conexiones hasta 5 min sin uso. Si el servicio
    // las cerrara antes, el proxy podría mandar una petición por una conexión ya cerrada y el
    // usuario vería un error suelto. Regla: el servidor espera más que quien le reusa la conexión.
    keepAliveTimeout: KEEP_ALIVE_MS,
  });

  await app.register(helmet, { global: true });
  app.setErrorHandler(errorHandler);
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health", async () => ({ status: "ok", service: options.name }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await options.readiness?.();
      return { status: "ready", service: options.name };
    } catch (err) {
      app.log.error({ err }, "Readiness falló");
      return reply.status(503).send({ status: "unavailable", service: options.name });
    }
  });

  return app;
}
