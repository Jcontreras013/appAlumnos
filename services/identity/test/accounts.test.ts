import type { CreatedUserDto, DepartmentDto, PasswordResetDto, UserDto } from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../src/db/schema";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let root: string;
let dirA: string;
let departmental: string;
let distritalUtila: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  ctx = await setupIdentity();
  root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const post = (url: string, payload: object, token = root) =>
    ctx.app.inject({ method: "POST", url, headers: ctx.auth(token), payload });
  const department = (
    await post("/departments", { code: "11", name: "Islas de la Bahía" })
  ).json<DepartmentDto>();
  const roatan = (await post(`/departments/${department.id}/districts`, { name: "Roatán" })).json<{
    id: string;
  }>();
  const utila = (await post(`/departments/${department.id}/districts`, { name: "Utila" })).json<{
    id: string;
  }>();
  for (const [slug, districtId] of [
    ["escuela-a", roatan.id],
    ["escuela-b", roatan.id],
  ] as const) {
    const res = await post("/schools", {
      name: slug,
      slug,
      sector: "publico",
      districtId,
      admin: { name: `Director ${slug}`, email: `director@${slug}.hn`, password: PASSWORD },
    });
    ids[slug] = res.json().school.id;
    ids[`dir-${slug}`] = res.json().admin.id;
  }
  await post("/regional-users", {
    name: "Departamental",
    email: "departamental@ihb.hn",
    password: PASSWORD,
    role: "director_departamental",
    departmentId: department.id,
  });
  await post("/regional-users", {
    name: "Distrital Utila",
    email: "distrital@utila.hn",
    password: PASSWORD,
    role: "director_distrital",
    districtId: utila.id,
  });
  dirA = await ctx.tokenFor("director@escuela-a.hn");
  const dirB = await ctx.tokenFor("director@escuela-b.hn");
  departmental = await ctx.tokenFor("departamental@ihb.hn");
  distritalUtila = await ctx.tokenFor("distrital@utila.hn");
  const teacher = (token: string, email: string) =>
    post("/users", { name: email, email, password: PASSWORD, role: "docente" }, token).then(
      (r) => r.json<CreatedUserDto>().id,
    );
  ids.t1 = await teacher(dirA, "t1@escuela-a.hn");
  ids.t2 = await teacher(dirA, "t2@dos-escuelas.hn");
  await teacher(dirB, "t2@dos-escuelas.hn"); // la misma maestra en la escuela B
});
afterAll(() => ctx.close());

const reset = (token: string, userId: string) =>
  ctx.app.inject({ method: "POST", url: `/accounts/${userId}/reset-password`, headers: ctx.auth(token) });

describe("bloqueo por intentos fallidos", () => {
  it("tras 5 intentos fallidos la cuenta se bloquea, aunque después se escriba bien la contraseña", async () => {
    for (let i = 0; i < 5; i++)
      expect((await ctx.login("t1@escuela-a.hn", "mala-contraseña-1")).res.statusCode).toBe(401);
    const blocked = await ctx.login("t1@escuela-a.hn", PASSWORD);
    expect(blocked.res.statusCode).toBe(401);
    expect(blocked.res.json().error.message).toContain("se bloquea 15 minutos");
    const [row] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, ids.t1 as string));
    expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it("una contraseña temporal de la dirección la desbloquea", async () => {
    const res = await reset(dirA, ids.t1 as string);
    expect(res.statusCode).toBe(200);
    const body = res.json<PasswordResetDto>();
    expect(body).toMatchObject({ name: "t1@escuela-a.hn", login: "t1@escuela-a.hn" });
    const login = await ctx.login("t1@escuela-a.hn", body.temporaryPassword);
    expect(login.res.statusCode).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it("entrar bien reinicia la cuenta de intentos", async () => {
    await reset(root, ids["dir-escuela-b"] as string); // dejar al director B con temporal
    const email = "director@escuela-a.hn";
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4; i++) await ctx.login(email, "mala-contraseña-1");
      expect((await ctx.login(email, PASSWORD)).res.statusCode).toBe(200);
    }
  });
});

describe("quién restablece la contraseña de quién", () => {
  it("la dirección, solo a su personal (no a quien también trabaja en otro centro, ni a otra dirección)", async () => {
    expect((await reset(dirA, ids.t2 as string)).statusCode).toBe(403);
    expect((await reset(dirA, ids["dir-escuela-b"] as string)).statusCode).toBe(404);
    expect((await reset(dirA, ids["dir-escuela-a"] as string)).statusCode).toBe(403); // a sí misma
  });

  it("la departamental, a los centros de su departamento (directores incluidos)", async () => {
    expect((await reset(departmental, ids["dir-escuela-a"] as string)).statusCode).toBe(200);
    expect((await reset(departmental, ids.t2 as string)).statusCode).toBe(200);
  });

  it("la distrital, solo a los centros de su distrito", async () => {
    expect((await reset(distritalUtila, ids["dir-escuela-a"] as string)).statusCode).toBe(404);
  });

  it("nadie restablece al equipo de la plataforma; un docente no restablece a nadie", async () => {
    const me = (await ctx.app.inject({ method: "GET", url: "/me", headers: ctx.auth(root) })).json<{
      user: UserDto;
    }>();
    expect((await reset(departmental, me.user.id)).statusCode).toBe(404);
    const t2 = await ctx.tokenFor(
      "t2@dos-escuelas.hn",
      (await reset(root, ids.t2 as string)).json<PasswordResetDto>().temporaryPassword,
    );
    expect((await reset(t2, ids.t1 as string)).statusCode).toBe(403);
  });

  it("la departamental ve al personal de un centro de su ámbito (sin familias); la distrital de otro, no", async () => {
    const staff = await ctx.app.inject({
      method: "GET",
      url: `/scope/schools/${ids["escuela-a"]}/staff`,
      headers: ctx.auth(departmental),
    });
    expect(
      staff
        .json<UserDto[]>()
        .map((u) => u.role)
        .sort(),
    ).toEqual(["admin", "docente", "docente"]);
    const other = await ctx.app.inject({
      method: "GET",
      url: `/scope/schools/${ids["escuela-a"]}/staff`,
      headers: ctx.auth(distritalUtila),
    });
    expect(other.statusCode).toBe(404);
  });
});
