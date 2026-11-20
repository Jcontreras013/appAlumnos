import { type CryptoKey, exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  authPlugin,
  createAccessTokenVerifier,
  JWT_ALGORITHM,
  requireRole,
  tenantOf,
} from "./auth";
import { databaseUrlFromEnv } from "./config";
import { createDb, poolConfig, requestPoolConfig } from "./db";
import { conflict, isDatabaseUnavailable, isUniqueViolation, parseOrThrow } from "./errors";
import { createService, KEEP_ALIVE_MS } from "./server";

const keys = await generateKeyPair(JWT_ALGORITHM, { extractable: true });
const otherKeys = await generateKeyPair(JWT_ALGORITHM);

async function token(
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; issuer?: string; audience?: string; expiresIn?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setIssuer(opts.issuer ?? ACCESS_TOKEN_ISSUER)
    .setAudience(opts.audience ?? ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expiresIn ?? 60))
    .sign(opts.key ?? keys.privateKey);
}

const app = await createService({ name: "prueba", logger: false });

beforeAll(async () => {
  await app.register(authPlugin, {
    verifier: await createAccessTokenVerifier({ publicKeyPem: await exportSPKI(keys.publicKey) }),
  });
  app.get("/finanzas", { preHandler: [app.authenticate, requireRole("finanzas", "admin")] }, async (req) => ({
    schoolId: tenantOf(req),
  }));
  app.post("/validar", async (req) => parseOrThrow(z.object({ monto: z.number().int() }), req.body));
  app.get("/conflicto", async () => {
    throw conflict("Ya existe");
  });
  app.get("/explota", async () => {
    throw new Error("detalle interno: password=1234");
  });
  app.get("/base-reiniciando", async () => {
    throw Object.assign(new Error("Failed query: select 1"), {
      cause: Object.assign(new Error("terminating connection due to administrator command"), {
        code: "57P01",
      }),
    });
  });
});
afterAll(() => app.close());

const get = (url: string, bearer?: string) =>
  app.inject({ url, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });

describe("autenticación", () => {
  it("acepta un token válido del rol permitido y expone el colegio", async () => {
    const res = await get("/finanzas", await token({ role: "finanzas", school_id: "colegio-1" }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ schoolId: "colegio-1" });
  });

  it.each([
    ["sin token", undefined],
    ["token basura", "abc.def.ghi"],
  ])("rechaza %s con 401", async (_name, bearer) => {
    expect((await get("/finanzas", bearer)).statusCode).toBe(401);
  });

  it("rechaza tokens firmados con otra llave", async () => {
    const forged = await token({ role: "admin", school_id: "x" }, { key: otherKeys.privateKey });
    expect((await get("/finanzas", forged)).statusCode).toBe(401);
  });

  it("rechaza tokens de otro emisor o para otra audiencia", async () => {
    const wrongIssuer = await token({ role: "admin", school_id: "x" }, { issuer: "otro" });
    const wrongAudience = await token({ role: "admin", school_id: "x" }, { audience: "otra-api" });
    expect((await get("/finanzas", wrongIssuer)).statusCode).toBe(401);
    expect((await get("/finanzas", wrongAudience)).statusCode).toBe(401);
  });

  it("rechaza tokens vencidos", async () => {
    const expired = await token({ role: "admin", school_id: "x" }, { expiresIn: -10 });
    expect((await get("/finanzas", expired)).statusCode).toBe(401);
  });

  it("rechaza roles inventados", async () => {
    expect((await get("/finanzas", await token({ role: "dios", school_id: "x" }))).statusCode).toBe(401);
  });

  it("rol sin permiso => 403", async () => {
    const res = await get("/finanzas", await token({ role: "docente", school_id: "x" }));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  });

  it("un usuario sin colegio no puede operar en rutas de colegio", async () => {
    const res = await get("/finanzas", await token({ role: "admin", school_id: null }));
    expect(res.statusCode).toBe(403);
  });
});

describe("errores", () => {
  it("validación => 400 con detalle por campo", async () => {
    const res = await app.inject({ method: "POST", url: "/validar", payload: { monto: 10.5 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: "validation_error",
      details: { fields: [{ path: "monto" }] },
    });
  });

  it("errores de negocio conservan su código y mensaje", async () => {
    const res = await get("/conflicto");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "conflict", message: "Ya existe" } });
  });

  it("un error inesperado no filtra detalles internos y da una referencia rastreable", async () => {
    const res = await app.inject({ url: "/explota", headers: { "x-request-id": "ref-777" } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("password");
    expect(res.json().error.message).toContain("ref-777");
  });

  it("agrega headers de seguridad", async () => {
    const res = await get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("si la base se está reiniciando, responde 503 «intenta de nuevo» (no un error inesperado)", async () => {
    const res = await get("/base-reiniciando");
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json()).toMatchObject({ error: { code: "service_unavailable" } });
  });

  it("reconoce cuando la base no está disponible, aunque venga envuelto por el ORM", () => {
    const shutdown = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
    });
    expect(isDatabaseUnavailable({ message: "Failed query", cause: shutdown })).toBe(true);
    expect(isDatabaseUnavailable(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDatabaseUnavailable(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isDatabaseUnavailable({ cause: { code: "ECONNREFUSED" } })).toBe(true);
    const rollback = new Error("Client has encountered a connection error and is not queryable");
    expect(isDatabaseUnavailable({ message: "Failed query: rollback", cause: rollback })).toBe(true);
    expect(isDatabaseUnavailable({ cause: { code: "23505" } })).toBe(false);
    expect(isDatabaseUnavailable(new Error("otro"))).toBe(false);
  });

  it("detecta violaciones UNIQUE aunque vengan envueltas por el ORM", () => {
    const pgError = { code: "23505", constraint: "users_email_unique" };
    expect(isUniqueViolation({ message: "wrapped", cause: pgError }, "users_email_unique")).toBe(true);
    expect(isUniqueViolation({ cause: pgError }, "otra_restriccion")).toBe(false);
    expect(isUniqueViolation(new Error("otro"))).toBe(false);
  });
});

describe("configuración", () => {
  it("arma la URL de Postgres desde las variables que inyecta ECS, escapando la contraseña", () => {
    const saved = { ...process.env };
    try {
      delete process.env.DATABASE_URL;
      Object.assign(process.env, {
        DB_HOST: "db.interno",
        DB_USER: "escolar",
        DB_PASSWORD: "p@ss:w/rd",
        DB_NAME: "escolar_identity",
      });
      expect(databaseUrlFromEnv()).toBe(
        "postgres://escolar:p%40ss%3Aw%2Frd@db.interno:5432/escolar_identity?sslmode=require",
      );
    } finally {
      process.env = saved;
    }
  });
});

describe("conexiones", () => {
  it("el servicio mantiene las conexiones más tiempo que el proxy que las reusa", () => {
    expect(app.server.keepAliveTimeout).toBe(KEEP_ALIVE_MS);
    expect(KEEP_ALIVE_MS).toBeGreaterThan(5 * 60 * 1000);
  });
});

describe("base de datos", () => {
  it("las peticiones tienen límite de tiempo; las migraciones no", () => {
    const url = "postgres://u:p@db:5432/escolar_identity?sslmode=require";
    const config = requestPoolConfig(url, {
      connectTimeoutMs: 5000,
      statementTimeoutMs: 30000,
      idleInTransactionTimeoutMs: 60000,
      maxConnections: 10,
    });
    expect(config).toMatchObject({
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 60000,
      keepAlive: true,
      max: 10,
      ssl: { rejectUnauthorized: false },
    });
    expect(config.maxLifetimeSeconds).toBeGreaterThan(0);
    expect(poolConfig(url)).not.toHaveProperty("statement_timeout");
  });

  it("si la base cierra una conexión inactiva, el servicio no se cae", async () => {
    const seen: Error[] = [];
    const { pool } = createDb("postgres://u:p@127.0.0.1:1/x", {}, { onIdleError: (err) => seen.push(err) });
    expect(pool.listenerCount("error")).toBe(1);
    expect(() =>
      pool.emit("error", new Error("terminating connection due to administrator command")),
    ).not.toThrow();
    expect(seen).toHaveLength(1);
    await pool.end();
  });

  it("sin base de datos, la petición falla rápido en vez de quedarse esperando", async () => {
    const { pool } = createDb(
      "postgres://u:p@10.255.255.1:5432/x",
      {},
      {
        limits: {
          connectTimeoutMs: 300,
          statementTimeoutMs: 1000,
          idleInTransactionTimeoutMs: 1000,
          maxConnections: 1,
        },
      },
    );
    const started = Date.now();
    await expect(pool.query("select 1")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    await pool.end();
  });
});
