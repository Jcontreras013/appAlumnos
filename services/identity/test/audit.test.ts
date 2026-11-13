import type { AuditEventDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let admin: string;

beforeAll(async () => {
  ctx = await setupIdentity();
  ({ adminToken: admin } = await ctx.createSchool("escuela-a"));
  await ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(admin),
    payload: { name: "Docente Uno", email: "docente@escuela-a.hn", password: PASSWORD, role: "docente" },
  });
});
afterAll(() => ctx.close());

describe("bitácora del centro (accesos y cuentas)", () => {
  it("la dirección ve los inicios de sesión y las cuentas creadas de su centro", async () => {
    await ctx.tokenFor("docente@escuela-a.hn");
    const res = await ctx.app.inject({ method: "GET", url: "/audit", headers: ctx.auth(admin) });
    const actions = res.json<AuditEventDto[]>().map((e) => e.action);
    expect(actions[0]).toBe("auth.login");
    expect(actions).toContain("user.created");
    expect(res.json<AuditEventDto[]>().every((e) => e.source === "identity")).toBe(true);
  });

  it("otro centro no ve nada y un docente no la consulta", async () => {
    const { adminToken: other } = await ctx.createSchool("escuela-b");
    const res = await ctx.app.inject({ method: "GET", url: "/audit", headers: ctx.auth(other) });
    expect(
      res.json<AuditEventDto[]>().every((e) => e.actorUserId !== null && e.action !== "user.created"),
    ).toBe(true);
    const teacher = await ctx.tokenFor("docente@escuela-a.hn");
    expect(
      (await ctx.app.inject({ method: "GET", url: "/audit", headers: ctx.auth(teacher) })).statusCode,
    ).toBe(403);
  });
});
