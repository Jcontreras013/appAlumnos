import { createAccessTokenVerifier } from "@escolar/service-kit";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;

beforeAll(async () => {
  ctx = await setupIdentity();
});
afterAll(() => ctx.close());

describe("salud", () => {
  it("responde /health y /health/ready", async () => {
    expect((await ctx.app.inject("/health")).json()).toEqual({ status: "ok", service: "identity" });
    expect((await ctx.app.inject("/health/ready")).statusCode).toBe(200);
  });

  it("devuelve el id de petición en cada respuesta", async () => {
    const res = await ctx.app.inject({ url: "/health", headers: { "x-request-id": "traza-123" } });
    expect(res.headers["x-request-id"]).toBe("traza-123");
  });
});

describe("login", () => {
  it("devuelve tokens y el usuario", async () => {
    const { res, body } = await ctx.login(SUPERADMIN.email, SUPERADMIN.password);
    expect(res.statusCode).toBe(200);
    expect(body.user).toMatchObject({ email: SUPERADMIN.email, role: "superadmin", schoolId: null });
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken.length).toBeGreaterThan(40);
    expect(body).not.toHaveProperty("refreshTokenId");
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("normaliza el correo (mayúsculas y espacios)", async () => {
    const { res } = await ctx.login(`  ${SUPERADMIN.email.toUpperCase()} `, SUPERADMIN.password);
    expect(res.statusCode).toBe(200);
  });

  it("no revela si el correo existe: mismo error para correo inexistente y contraseña incorrecta", async () => {
    const wrongPassword = await ctx.login(SUPERADMIN.email, "otra-contraseña-incorrecta");
    const unknownEmail = await ctx.login("nadie@ningun-lado.hn", "otra-contraseña-incorrecta");
    expect(wrongPassword.res.statusCode).toBe(401);
    expect(unknownEmail.res.statusCode).toBe(401);
    expect(wrongPassword.res.json()).toEqual(unknownEmail.res.json());
  });

  it("valida el cuerpo con mensajes en español", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "no-es-correo" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
    expect(res.json().error.message).toBe("Escribe tu contraseña");
  });

  it("registra el login fallido en la bitácora", async () => {
    await ctx.login(SUPERADMIN.email, "contraseña-mala-para-bitacora");
    const rows = await ctx.db.execute(
      sql`select count(*)::int as n from audit_events where action = 'auth.login_failed'`,
    );
    expect((rows as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBeGreaterThan(0);
  });
});

describe("tokens", () => {
  it("el access token lo puede verificar otro servicio solo con la llave pública (JWKS)", async () => {
    const { body } = await ctx.login(SUPERADMIN.email, SUPERADMIN.password);
    const jwks = (await ctx.app.inject("/.well-known/jwks.json")).json();
    expect(jwks.keys[0]).toMatchObject({ kid: "test-key", alg: "EdDSA", use: "sig", kty: "OKP" });
    expect(jwks.keys[0]).not.toHaveProperty("d"); // nunca exponer la parte privada

    const verify = await createAccessTokenVerifier({ publicKey: ctx.keys.publicKey });
    expect(await verify(body.accessToken)).toEqual({
      userId: body.user.id,
      name: "Root",
      schoolId: null,
      districtId: null,
      departmentId: null,
      role: "superadmin",
    });
  });

  it("rechaza tokens alterados", async () => {
    const { body } = await ctx.login(SUPERADMIN.email, SUPERADMIN.password);
    const [header, payload, signature] = body.accessToken.split(".");
    const forged = JSON.parse(Buffer.from(payload ?? "", "base64url").toString());
    forged.role = "admin";
    const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`;
    const res = await ctx.app.inject({ url: "/me", headers: ctx.auth(tampered) });
    expect(res.statusCode).toBe(401);
  });

  it("/me exige token", async () => {
    const res = await ctx.app.inject("/me");
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
  });

  it("/me devuelve el usuario y su colegio", async () => {
    const { adminToken, schoolId } = await ctx.createSchool("colegio-me");
    const res = await ctx.app.inject({ url: "/me", headers: ctx.auth(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { role: "admin", schoolId },
      school: { id: schoolId, slug: "colegio-me", rtn: "08011990123456" },
    });
  });
});

describe("bitácora", () => {
  it("es de solo inserción: la base de datos rechaza UPDATE y DELETE", async () => {
    await expect(ctx.db.execute(sql`update audit_events set action = 'x'`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`delete from audit_events`)).rejects.toThrow();
  });
});

describe("contraseña", () => {
  it("se guarda con Argon2id, nunca en texto plano", async () => {
    const result = await ctx.db.execute(
      sql`select password_hash from users where email = ${SUPERADMIN.email}`,
    );
    const hash = (result as unknown as { rows: Array<{ password_hash: string }> }).rows[0]?.password_hash;
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(SUPERADMIN.password);
    expect(PASSWORD).not.toBe(SUPERADMIN.password);
  });
});
