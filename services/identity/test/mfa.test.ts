import type {
  DepartmentDto,
  LoginResponseDto,
  MeResponseDto,
  MfaChallengeDto,
  MfaEnabledDto,
  MfaSetupDto,
} from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../src/db/schema";
import { totpCode } from "../src/lib/totp";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

/**
 * Verificación en dos pasos (2FA) para las cuentas que ven muchos centros. Los códigos se calculan
 * para el paso de 30 s siguiente: el del paso actual ya se usó al activarla y no sirve dos veces.
 */

let ctx: IdentityTestContext;
let root: string;
let secret: string;
let recovery: string[];

const nextCode = (key: string) => totpCode(key, new Date(Date.now() + 30_000));
const post = (url: string, token: string | null, payload?: object) =>
  ctx.app.inject({ method: "POST", url, headers: token ? ctx.auth(token) : {}, payload });
const me = async (token: string) =>
  (await ctx.app.inject({ method: "GET", url: "/me", headers: ctx.auth(token) })).json<MeResponseDto>();
const loginMfa = (challenge: string, code: string) => post("/auth/login/mfa", null, { challenge, code });

beforeAll(async () => {
  ctx = await setupIdentity();
  root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const department = (
    await post("/departments", root, { code: "11", name: "Islas de la Bahía" })
  ).json<DepartmentDto>();
  const district = (await post(`/departments/${department.id}/districts`, root, { name: "Roatán" })).json<{
    id: string;
  }>();
  await post("/regional-users", root, {
    name: "Departamental",
    email: "departamental@ihb.hn",
    password: PASSWORD,
    role: "director_departamental",
    departmentId: department.id,
  });
  await post("/regional-users", root, {
    name: "Distrital",
    email: "distrital@roatan.hn",
    password: PASSWORD,
    role: "director_distrital",
    districtId: district.id,
  });
  await post("/schools", root, {
    name: "Escuela Uno",
    slug: "escuela-uno",
    sector: "publico",
    districtId: district.id,
    admin: { name: "Directora", email: "director@uno.hn", password: PASSWORD },
  });
});
afterAll(() => ctx.close());

describe("activar la verificación en dos pasos", () => {
  it("la departamental debe activarla; una dirección de centro no", async () => {
    const departmental = await ctx.tokenFor("departamental@ihb.hn");
    expect((await me(departmental)).mfa).toEqual({
      enabled: false,
      setupRequired: true,
      recoveryCodesLeft: 0,
    });
    const director = await ctx.tokenFor("director@uno.hn");
    expect((await me(director)).mfa.setupRequired).toBe(false);
  });

  it("se activa con el primer código de la app y entrega 10 códigos de recuperación", async () => {
    const token = await ctx.tokenFor("departamental@ihb.hn");
    const setup = (await post("/auth/mfa/setup", token)).json<MfaSetupDto>();
    secret = setup.secret;
    expect(setup.otpauthUrl).toContain(`secret=${secret}`);
    expect(setup.otpauthUrl).toContain("departamental%40ihb.hn");

    expect((await post("/auth/mfa/enable", token, { code: "000000" })).statusCode).toBe(400);
    const enabled = await post("/auth/mfa/enable", token, { code: totpCode(secret, new Date()) });
    expect(enabled.statusCode).toBe(200);
    recovery = enabled.json<MfaEnabledDto>().recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await me(token)).mfa).toEqual({ enabled: true, setupRequired: false, recoveryCodesLeft: 10 });
    expect((await post("/auth/mfa/setup", token)).statusCode).toBe(409);
  });
});

describe("iniciar sesión con dos pasos", () => {
  let challenge: string;

  it("la contraseña sola ya no abre sesión: devuelve un desafío", async () => {
    const res = await ctx.login("departamental@ihb.hn", PASSWORD);
    expect(res.res.statusCode).toBe(200);
    const body = res.res.json<MfaChallengeDto & Partial<LoginResponseDto>>();
    expect(body.mfaRequired).toBe(true);
    expect(body.accessToken).toBeUndefined();
    challenge = body.challenge;
  });

  it("un código equivocado no entra; el correcto abre la sesión y el desafío ya no sirve", async () => {
    expect((await loginMfa(challenge, "123456")).statusCode).toBe(401);
    const ok = await loginMfa(challenge, nextCode(secret));
    expect(ok.statusCode).toBe(200);
    expect(ok.json<LoginResponseDto>().user.role).toBe("director_departamental");
    const again = await loginMfa(challenge, nextCode(secret));
    expect(again.statusCode).toBe(401);
    expect(again.json<{ error: { message: string } }>().error.message).toContain("venció");
  });

  it("un código de recuperación sirve una sola vez", async () => {
    const first = (await ctx.login("departamental@ihb.hn", PASSWORD)).res.json<MfaChallengeDto>().challenge;
    const code = (recovery[0] as string).toLowerCase().replace("-", " ");
    const ok = await loginMfa(first, code);
    expect(ok.statusCode).toBe(200);
    expect((await me(ok.json<LoginResponseDto>().accessToken)).mfa.recoveryCodesLeft).toBe(9);
    const second = (await ctx.login("departamental@ihb.hn", PASSWORD)).res.json<MfaChallengeDto>().challenge;
    expect((await loginMfa(second, recovery[0] as string)).statusCode).toBe(401);
  });

  it("cinco códigos equivocados bloquean la cuenta 15 minutos", async () => {
    const token = await ctx.tokenFor("distrital@roatan.hn");
    const key = (await post("/auth/mfa/setup", token)).json<MfaSetupDto>().secret;
    await post("/auth/mfa/enable", token, { code: totpCode(key, new Date()) });
    const challenge_ = (await ctx.login("distrital@roatan.hn", PASSWORD)).res.json<MfaChallengeDto>()
      .challenge;
    for (let i = 0; i < 5; i++) expect((await loginMfa(challenge_, "111111")).statusCode).toBe(401);
    expect((await loginMfa(challenge_, nextCode(key))).statusCode).toBe(401);
    expect((await ctx.login("distrital@roatan.hn", PASSWORD)).res.statusCode).toBe(401);
  });
});

describe("restablecer (teléfono perdido)", () => {
  it("solo el equipo de la plataforma la quita; la persona la vuelve a activar al entrar", async () => {
    const director = await ctx.tokenFor("director@uno.hn");
    const reset = (token: string, login: string) => post("/accounts/mfa/reset", token, { login });
    expect((await reset(director, "departamental@ihb.hn")).statusCode).toBe(403);
    expect((await reset(root, "nadie@ihb.hn")).statusCode).toBe(404);
    expect((await reset(root, SUPERADMIN.email)).statusCode).toBe(403);
    expect((await reset(root, "Departamental@IHB.hn")).statusCode).toBe(204);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, "departamental@ihb.hn"));
    expect(user?.totpSecret).toBeNull();
    expect(user?.recoveryCodeHashes).toEqual([]);
    const res = await ctx.login("departamental@ihb.hn", PASSWORD);
    const body = res.res.json<LoginResponseDto>();
    expect(body.accessToken).toBeTruthy();
    expect((await me(body.accessToken)).mfa.setupRequired).toBe(true);
  });
});

describe("en una demo (REQUIRE_MFA=false)", () => {
  it("nadie está obligado, pero quien quiera la puede activar", async () => {
    const demo = await setupIdentity({ requireMfa: false });
    const token = await demo.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
    const res = await demo.app.inject({ method: "GET", url: "/me", headers: demo.auth(token) });
    expect(res.json<MeResponseDto>().mfa).toEqual({
      enabled: false,
      setupRequired: false,
      recoveryCodesLeft: 0,
    });
    const setup = await demo.app.inject({
      method: "POST",
      url: "/auth/mfa/setup",
      headers: demo.auth(token),
    });
    expect(setup.statusCode).toBe(200);
    await demo.close();
  });
});
