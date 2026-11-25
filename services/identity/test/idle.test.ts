import type { FamilyAccountDto, LoginResponseDto } from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { refreshTokens } from "../src/db/schema";
import { type IdentityTestContext, PASSWORD, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let admin: string;

beforeAll(async () => {
  ctx = await setupIdentity();
  admin = (await ctx.createSchool("escuela-inactiva")).adminToken;
  await ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(admin),
    payload: {
      name: "Sara Secretaria",
      email: "secretaria@inactiva.hn",
      password: PASSWORD,
      role: "secretaria",
    },
  });
});
afterAll(() => ctx.close());

const refresh = (refreshToken: string) =>
  ctx.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
describe("sesión que se cierra por inactividad", () => {
  it("el personal que pasó más de 30 minutos sin usarla vuelve a entrar", async () => {
    const { body } = await ctx.login("admin@escuela-inactiva.hn", PASSWORD);
    await ctx.db
      .update(refreshTokens)
      .set({ createdAt: new Date(Date.now() - 40 * 60_000) })
      .where(eq(refreshTokens.userId, body.user.id));
    const res = await refresh(body.refreshToken);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain("inactividad");
    // Y la sesión queda cerrada aunque luego se intente otra vez.
    expect((await refresh(body.refreshToken)).statusCode).toBe(401);
  });

  it("con actividad reciente la sesión se renueva normal", async () => {
    const { body } = await ctx.login("secretaria@inactiva.hn", PASSWORD);
    await ctx.db
      .update(refreshTokens)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(refreshTokens.userId, body.user.id));
    expect((await refresh(body.refreshToken)).statusCode).toBe(200);
  });

  it("las familias no tienen ese límite (usan la app en su teléfono)", async () => {
    const secretaria = await ctx.tokenFor("secretaria@inactiva.hn");
    const account = (
      await ctx.app.inject({
        method: "POST",
        url: "/family-accounts",
        headers: ctx.auth(secretaria),
        payload: { name: "Marta Madre", nationalId: "0801-1980-77777" },
      })
    ).json<FamilyAccountDto>();
    const login = await ctx.login("0801198077777", account.temporaryPassword as string);
    const body = login.body as LoginResponseDto;
    await ctx.db
      .update(refreshTokens)
      .set({ createdAt: new Date(Date.now() - 5 * 24 * 60 * 60_000) })
      .where(eq(refreshTokens.userId, body.user.id));
    expect((await refresh(body.refreshToken)).statusCode).toBe(200);
  });
});
