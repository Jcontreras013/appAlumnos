import type { TokenPairDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;

// Sin ventana de gracia para poder probar la detección de reuso de forma determinista.
beforeAll(async () => {
  ctx = await setupIdentity({ refreshReuseGraceSeconds: 0 });
});
afterAll(() => ctx.close());

const refresh = (refreshToken: string) =>
  ctx.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });

describe("rotación de refresh tokens", () => {
  it("cambia el refresh token por uno nuevo y el anterior deja de servir", async () => {
    const { body: session } = await ctx.login(SUPERADMIN.email, SUPERADMIN.password);
    const first = await refresh(session.refreshToken);
    expect(first.statusCode).toBe(200);
    const pair = first.json() as TokenPairDto;
    expect(pair.refreshToken).not.toBe(session.refreshToken);
    expect((await ctx.app.inject({ url: "/me", headers: ctx.auth(pair.accessToken) })).statusCode).toBe(200);
  });

  it("si se reusa un token ya rotado (robo), se revoca toda la sesión, incluido el token nuevo", async () => {
    const { body: session } = await ctx.login(SUPERADMIN.email, SUPERADMIN.password);
    const legit = (await refresh(session.refreshToken)).json() as TokenPairDto;

    // Un atacante con el token viejo intenta usarlo
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    // ...y eso invalida también el token que tenía el usuario legítimo
    expect((await refresh(legit.refreshToken)).statusCode).toBe(401);
  });

  it("logout revoca la sesión y es idempotente", async () => {
    const { body: session } = await ctx.login(SUPERADMIN.email, SUPERADMIN.password);
    const logout = () =>
      ctx.app.inject({
        method: "POST",
        url: "/auth/logout",
        payload: { refreshToken: session.refreshToken },
      });
    expect((await logout()).statusCode).toBe(204);
    expect((await logout()).statusCode).toBe(204);
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
  });

  it("cerrar una sesión no afecta las demás sesiones del mismo usuario", async () => {
    const phone = (await ctx.login(SUPERADMIN.email, SUPERADMIN.password)).body;
    const laptop = (await ctx.login(SUPERADMIN.email, SUPERADMIN.password)).body;
    await ctx.app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refreshToken: phone.refreshToken },
    });
    expect((await refresh(laptop.refreshToken)).statusCode).toBe(200);
  });

  it("un token inventado no sirve", async () => {
    expect((await refresh("x".repeat(43))).statusCode).toBe(401);
  });
});

describe("ventana de gracia", () => {
  it("peticiones paralelas del navegador con el mismo token no cierran la sesión", async () => {
    const graceCtx = await setupIdentity({ refreshReuseGraceSeconds: 30 });
    try {
      const { body: session } = await graceCtx.login(SUPERADMIN.email, SUPERADMIN.password);
      const send = () =>
        graceCtx.app.inject({
          method: "POST",
          url: "/auth/refresh",
          payload: { refreshToken: session.refreshToken },
        });
      const results = await Promise.all([send(), send(), send()]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      for (const r of results) {
        const next = (r.json() as TokenPairDto).refreshToken;
        const again = await graceCtx.app.inject({
          method: "POST",
          url: "/auth/refresh",
          payload: { refreshToken: next },
        });
        expect(again.statusCode).toBe(200);
      }
    } finally {
      await graceCtx.close();
    }
  });
});
