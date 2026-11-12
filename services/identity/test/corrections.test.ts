import type { CreatedUserDto, DepartmentDto, UserDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

/** Corregir datos mal capturados (nombre, identidad, correo) y cambiar el cargo de alguien. */

let ctx: IdentityTestContext;
let root: string;
let dirA: string;
let departmental: string;
const ids: Record<string, string> = {};

type ErrorBody = { error: { message: string } };

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
  for (const slug of ["escuela-a", "escuela-b"]) {
    const res = await post("/schools", {
      name: slug,
      slug,
      sector: "publico",
      districtId: roatan.id,
      admin: { name: `Director ${slug}`, email: `director@${slug}.hn`, password: PASSWORD },
    });
    ids[`dir-${slug}`] = res.json().admin.id;
  }
  await post("/regional-users", {
    name: "Departamental",
    email: "departamental@ihb.hn",
    password: PASSWORD,
    role: "director_departamental",
    departmentId: department.id,
  });
  dirA = await ctx.tokenFor("director@escuela-a.hn");
  const dirB = await ctx.tokenFor("director@escuela-b.hn");
  departmental = await ctx.tokenFor("departamental@ihb.hn");
  const staff = (token: string, payload: object) =>
    post("/users", { password: PASSWORD, role: "docente", ...payload }, token).then(
      (r) => r.json<CreatedUserDto>().id,
    );
  ids.mal = await staff(dirA, { name: "Maria Lopes", nationalId: "0801-1990-00001" });
  ids.otra = await staff(dirA, { name: "Otra Docente", nationalId: "0801-1990-00002" });
  ids.dos = await staff(dirA, { name: "Dos Escuelas", email: "dos@escuelas.hn" });
  await staff(dirB, { name: "Dos Escuelas", email: "dos@escuelas.hn" });
});
afterAll(() => ctx.close());

const update = (token: string, id: string, payload: object) =>
  ctx.app.inject({ method: "PUT", url: `/accounts/${id}`, headers: ctx.auth(token), payload });
const changeRole = (token: string, id: string, payload: object) =>
  ctx.app.inject({ method: "PUT", url: `/users/${id}/role`, headers: ctx.auth(token), payload });

describe("corregir los datos de una cuenta", () => {
  it("la dirección corrige nombre e identidad; la persona entra con la identidad nueva", async () => {
    const res = await update(dirA, ids.mal as string, {
      name: "María López",
      nationalId: "0801-1990-00011",
      email: "",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<UserDto>()).toMatchObject({
      name: "María López",
      nationalId: "0801199000011",
      email: null,
    });
    expect((await ctx.login("0801-1990-00001", PASSWORD)).res.statusCode).toBe(401);
    const login = await ctx.login("0801-1990-00011", PASSWORD);
    expect(login.res.statusCode).toBe(200);
    expect(login.body.user.name).toBe("María López");
  });

  it("no deja dos cuentas con la misma identidad ni una cuenta sin con qué entrar", async () => {
    const dup = await update(dirA, ids.otra as string, { name: "Otra Docente", nationalId: "0801199000011" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<ErrorBody>().error.message).toContain("esa identidad");
    const empty = await update(dirA, ids.otra as string, { name: "Otra Docente", nationalId: "", email: "" });
    expect(empty.statusCode).toBe(400);
  });

  it("a quien también trabaja en otro centro la corrige la departamental, no una dirección", async () => {
    const res = await update(dirA, ids.dos as string, {
      name: "Dos Escuelas Bien",
      email: "dos@escuelas.hn",
    });
    expect(res.statusCode).toBe(403);
    const ok = await update(departmental, ids.dos as string, {
      name: "Dos Escuelas Bien",
      email: "dos@escuelas.hn",
    });
    expect(ok.statusCode).toBe(200);
  });

  it("la dirección no corrige a otra dirección ni a sí misma; la departamental sí corrige directores", async () => {
    expect(
      (await update(dirA, ids["dir-escuela-b"] as string, { name: "X Y", email: "x@y.hn" })).statusCode,
    ).toBe(404);
    expect(
      (
        await update(dirA, ids["dir-escuela-a"] as string, {
          name: "Yo Mismo",
          email: "director@escuela-a.hn",
        })
      ).statusCode,
    ).toBe(403);
    const fixed = await update(departmental, ids["dir-escuela-a"] as string, {
      name: "Directora Escuela A",
      email: "director@escuela-a.hn",
    });
    expect(fixed.statusCode).toBe(200);
  });
});

describe("cambiar el cargo", () => {
  it("de docente a coordinación: la sesión vieja deja de servir y entra con el cargo nuevo", async () => {
    const before = await ctx.login("0801-1990-00002", PASSWORD);
    const res = await changeRole(dirA, ids.otra as string, { from: "docente", to: "coordinador" });
    expect(res.statusCode).toBe(200);
    expect(res.json<UserDto>().role).toBe("coordinador");
    const refresh = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: before.body.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
    expect((await ctx.login("0801-1990-00002", PASSWORD)).body.user.role).toBe("coordinador");
  });

  it("no se duplica un cargo, no se vuelve familia y la dirección no se quita la suya", async () => {
    const same = await changeRole(dirA, ids.otra as string, { from: "coordinador", to: "coordinador" });
    expect(same.statusCode).toBe(400);
    expect(
      (await changeRole(dirA, ids.otra as string, { from: "coordinador", to: "padre" })).statusCode,
    ).toBe(400);
    const self = await changeRole(dirA, ids["dir-escuela-a"] as string, { from: "admin", to: "docente" });
    expect(self.statusCode).toBe(403);
    // Cargo que no tiene en este centro.
    expect(
      (await changeRole(dirA, ids.otra as string, { from: "docente", to: "secretaria" })).statusCode,
    ).toBe(404);
  });

  it("solo cambia el acceso de este centro", async () => {
    const res = await changeRole(dirA, ids.dos as string, { from: "docente", to: "secretaria" });
    expect(res.statusCode).toBe(200);
    const dirB = await ctx.tokenFor("director@escuela-b.hn");
    const inB = await ctx.app.inject({ method: "GET", url: `/users/${ids.dos}`, headers: ctx.auth(dirB) });
    expect(inB.json<UserDto>().role).toBe("docente");
  });
});
