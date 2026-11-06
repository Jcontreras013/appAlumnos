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
import { conflict, isUniqueViolation, parseOrThrow } from "./errors";
import { createService } from "./server";

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
