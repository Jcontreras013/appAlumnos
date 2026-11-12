import type { CreatedUserDto, DepartmentDto, FamilyAccountDto, ScopeActivityDto } from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../src/db/schema";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

/** Qué cuentas se usan de verdad en los centros del ámbito (para los indicadores del piloto). */

let ctx: IdentityTestContext;
let root: string;
let departmental: string;
let otherDepartmental: string;
let director: string;
let schoolId: string;
let secretary: CreatedUserDto;
let family: FamilyAccountDto;

beforeAll(async () => {
  ctx = await setupIdentity();
  root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const post = (url: string, payload: object, token = root) =>
    ctx.app.inject({ method: "POST", url, headers: ctx.auth(token), payload });
  for (const [code, name, email] of [
    ["11", "Islas de la Bahía", "departamental@ihb.hn"],
    ["08", "Francisco Morazán", "departamental@fm.hn"],
  ] as const) {
    const department = (await post("/departments", { code, name })).json<DepartmentDto>();
    const district = (
      await post(`/departments/${department.id}/districts`, { name: `Distrito ${code}` })
    ).json<{
      id: string;
    }>();
    if (code === "11") {
      const res = await post("/schools", {
        name: "Escuela Uno",
        slug: "escuela-uno",
        sector: "publico",
        districtId: district.id,
        admin: { name: "Directora", email: "director@uno.hn", password: PASSWORD },
      });
      schoolId = res.json().school.id;
    }
    await post("/regional-users", {
      name: `Departamental ${code}`,
      email,
      password: PASSWORD,
      role: "director_departamental",
      departmentId: department.id,
    });
  }
  departmental = await ctx.tokenFor("departamental@ihb.hn");
  otherDepartmental = await ctx.tokenFor("departamental@fm.hn");
});
afterAll(() => ctx.close());

const activity = (token = departmental) =>
  ctx.app.inject({ method: "GET", url: "/scope/activity", headers: ctx.auth(token) });

describe("cuentas en uso por centro", () => {
  it("una cuenta cuenta como en uso cuando ya entró; el inicio de sesión queda con fecha", async () => {
    const [before] = await ctx.db.select().from(users).where(eq(users.email, "director@uno.hn"));
    expect(before?.lastLoginAt).toBeNull();
    expect((await activity()).json<ScopeActivityDto>().schools).toEqual([
      { schoolId, directorActive: false, secretaryActive: false },
    ]);
    director = await ctx.tokenFor("director@uno.hn");
    const [after] = await ctx.db.select().from(users).where(eq(users.email, "director@uno.hn"));
    expect(after?.lastLoginAt).toBeInstanceOf(Date);
    const res = await activity();
    expect(res.json<ScopeActivityDto>().schools[0]).toMatchObject({
      directorActive: true,
      secretaryActive: false,
    });
  });

  it("con contraseña temporal todavía no está en uso: hasta que la cambia", async () => {
    secretary = (
      await ctx.app.inject({
        method: "POST",
        url: "/users",
        headers: ctx.auth(director),
        payload: { name: "Secretaria", nationalId: "0801-1990-00005", role: "secretaria" },
      })
    ).json<CreatedUserDto>();
    const temp = secretary.temporaryPassword as string;
    const session = await ctx.tokenFor("0801199000005", temp);
    expect((await activity()).json<ScopeActivityDto>().schools[0]?.secretaryActive).toBe(false);
    const changed = await ctx.app.inject({
      method: "POST",
      url: "/auth/password",
      headers: ctx.auth(session),
      payload: { currentPassword: temp, newPassword: "secretaria-nueva-2026" },
    });
    expect(changed.statusCode).toBe(204);
    expect((await activity()).json<ScopeActivityDto>().schools[0]?.secretaryActive).toBe(true);
  });

  it("las familias que ya usan el portal vienen en la lista; las que no, no", async () => {
    family = (
      await ctx.app.inject({
        method: "POST",
        url: "/family-accounts",
        headers: ctx.auth(director),
        payload: { name: "Mamá de Luis", nationalId: "0801-1985-00009" },
      })
    ).json<FamilyAccountDto>();
    await ctx.app.inject({
      method: "POST",
      url: "/family-accounts",
      headers: ctx.auth(director),
      payload: { name: "Papá sin entrar", nationalId: "0801-1985-00010" },
    });
    const session = await ctx.tokenFor("0801198500009", family.temporaryPassword as string);
    await ctx.app.inject({
      method: "POST",
      url: "/auth/password",
      headers: ctx.auth(session),
      payload: { currentPassword: family.temporaryPassword, newPassword: "familia-nueva-2026" },
    });
    expect((await activity()).json<ScopeActivityDto>().activatedFamilyUserIds).toEqual([family.userId]);
  });

  it("cada departamental ve solo sus centros; un centro no pide esto", async () => {
    expect((await activity(otherDepartmental)).json<ScopeActivityDto>()).toEqual({
      schools: [],
      activatedFamilyUserIds: [],
    });
    expect((await activity(director)).statusCode).toBe(403);
  });
});
