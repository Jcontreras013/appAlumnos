import { createAccessTokenVerifier } from "@escolar/service-kit";
import type { CreatedUserDto, DepartmentDto, MeResponseDto, ScopedSchoolDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let root: string;
let department: DepartmentDto;
let roatan: { id: string };
let utila: { id: string };
const schoolIds: Record<string, string> = {};

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

beforeAll(async () => {
  ctx = await setupIdentity();
  root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const post = (url: string, payload: object) =>
    ctx.app.inject({ method: "POST", url, headers: ctx.auth(root), payload });

  department = (await post("/departments", { code: "11", name: "Islas de la Bahía" })).json();
  roatan = (await post(`/departments/${department.id}/districts`, { name: "Roatán" })).json();
  utila = (await post(`/departments/${department.id}/districts`, { name: "Utila" })).json();

  for (const [slug, districtId] of [
    ["escuela-coxen-hole", roatan.id],
    ["escuela-french-harbour", roatan.id],
    ["escuela-utila", utila.id],
  ] as const) {
    const res = await post("/schools", {
      name: `Escuela ${slug}`,
      slug,
      sector: "publico",
      code: `0101-${slug.length}`,
      districtId,
      admin: { name: `Director ${slug}`, email: `director@${slug}.hn`, password: PASSWORD },
    });
    schoolIds[slug] = res.json().school.id;
  }
  await post("/regional-users", {
    name: "Directora Departamental",
    email: "departamental@ihb.hn",
    password: PASSWORD,
    role: "director_departamental",
    departmentId: department.id,
  });
  await post("/regional-users", {
    name: "Director Distrital Roatán",
    email: "distrital@roatan.hn",
    password: PASSWORD,
    role: "director_distrital",
    districtId: roatan.id,
  });
});
afterAll(() => ctx.close());

const scope = async (token: string) =>
  (await ctx.app.inject({ url: "/scope/schools", headers: ctx.auth(token) })).json() as ScopedSchoolDto[];

describe("jerarquía departamento → distrito → centro", () => {
  it("la dirección departamental ve todos los centros de su departamento", async () => {
    const token = await ctx.tokenFor("departamental@ihb.hn");
    const schools = await scope(token);
    expect(schools.map((s) => s.slug).sort()).toEqual([
      "escuela-coxen-hole",
      "escuela-french-harbour",
      "escuela-utila",
    ]);
    expect(schools.find((s) => s.slug === "escuela-utila")).toMatchObject({
      districtName: "Utila",
      sector: "publico",
    });
  });

  it("la dirección distrital ve solo los de su distrito", async () => {
    const token = await ctx.tokenFor("distrital@roatan.hn");
    expect((await scope(token)).map((s) => s.slug).sort()).toEqual([
      "escuela-coxen-hole",
      "escuela-french-harbour",
    ]);
  });

  it("la dirección de un centro ve solo su centro", async () => {
    const token = await ctx.tokenFor("director@escuela-utila.hn");
    expect((await scope(token)).map((s) => s.slug)).toEqual(["escuela-utila"]);
  });

  it("el token de la departamental lleva su departamento y ningún centro", async () => {
    const { body } = await ctx.login("departamental@ihb.hn", PASSWORD);
    const verify = await createAccessTokenVerifier({ publicKey: ctx.keys.publicKey });
    expect(await verify(body.accessToken)).toMatchObject({
      role: "director_departamental",
      departmentId: department.id,
      districtId: null,
      schoolId: null,
    });
    const me = (
      await ctx.app.inject({ url: "/me", headers: ctx.auth(body.accessToken) })
    ).json() as MeResponseDto;
    expect(me.current).toMatchObject({
      scopeType: "departamento",
      scopeName: "Departamental de Islas de la Bahía",
    });
    expect(me.school).toBeNull();
  });

  it("las direcciones regionales no administran el personal de un centro", async () => {
    const token = await ctx.tokenFor("departamental@ihb.hn");
    expect((await ctx.app.inject({ url: "/users", headers: ctx.auth(token) })).statusCode).toBe(403);
  });

  it("el logo de un centro lo ve la regional si está en su ámbito", async () => {
    await ctx.app.inject({
      method: "PUT",
      url: `/schools/${schoolIds["escuela-utila"]}/logo`,
      headers: ctx.auth(root),
      payload: { image: PNG.toString("base64") },
    });
    const departmental = await ctx.tokenFor("departamental@ihb.hn");
    const distrital = await ctx.tokenFor("distrital@roatan.hn");
    const url = `/scope/schools/${schoolIds["escuela-utila"]}/logo`;
    expect((await ctx.app.inject({ url, headers: ctx.auth(departmental) })).statusCode).toBe(200);
    expect((await ctx.app.inject({ url, headers: ctx.auth(distrital) })).statusCode).toBe(404);
  });

  it("valida que cada dirección regional vaya con su ámbito", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/regional-users",
      headers: ctx.auth(root),
      payload: {
        name: "Mal configurado",
        email: "mal@ihb.hn",
        password: PASSWORD,
        role: "director_departamental",
        districtId: roatan.id,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("una maestra en dos escuelas (jornada matutina y vespertina)", () => {
  let maestra: CreatedUserDto;

  beforeAll(async () => {
    const directorA = await ctx.tokenFor("director@escuela-coxen-hole.hn");
    const directorB = await ctx.tokenFor("director@escuela-french-harbour.hn");
    const create = (token: string, password: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/users",
        headers: ctx.auth(token),
        payload: { name: "Maestra Mejía", email: "maestra@ihb.hn", password, role: "docente" },
      });
    maestra = (await create(directorA, PASSWORD)).json();
    const second = (await create(directorB, "clave-distinta-ignorada")).json() as CreatedUserDto;
    expect(maestra.linkedExisting).toBe(false);
    expect(second.linkedExisting).toBe(true);
    expect(second.id).toBe(maestra.id);
  });

  it("tiene una sola cuenta con dos accesos y cambia de escuela sin volver a iniciar sesión", async () => {
    const { body } = await ctx.login("maestra@ihb.hn", PASSWORD);
    const me = (
      await ctx.app.inject({ url: "/me", headers: ctx.auth(body.accessToken) })
    ).json() as MeResponseDto;
    expect(me.memberships.map((m) => m.scopeName).sort()).toEqual([
      "Escuela escuela-coxen-hole",
      "Escuela escuela-french-harbour",
    ]);
    const other = me.memberships.find((m) => m.id !== me.current.id);

    const switched = await ctx.app.inject({
      method: "POST",
      url: "/auth/switch",
      headers: ctx.auth(body.accessToken),
      payload: { membershipId: other?.id, refreshToken: body.refreshToken },
    });
    expect(switched.statusCode).toBe(200);
    const me2 = (
      await ctx.app.inject({ url: "/me", headers: ctx.auth(switched.json().accessToken) })
    ).json() as MeResponseDto;
    expect(me2.current.id).toBe(other?.id);
    expect(me2.school?.id).toBe(other?.scopeId);

    // El refresh token de la sesión anterior quedó revocado
    const old = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: body.refreshToken },
    });
    expect(old.statusCode).toBe(401);

    // Al volver a iniciar sesión entra al último centro usado
    const again = await ctx.login("maestra@ihb.hn", PASSWORD);
    expect(again.body.user.schoolId).toBe(other?.scopeId);
  });

  it("no puede cambiarse a un acceso que no es suyo", async () => {
    const { body } = await ctx.login("maestra@ihb.hn", PASSWORD);
    const director = await ctx.login("director@escuela-utila.hn", PASSWORD);
    const directorMe = (
      await ctx.app.inject({ url: "/me", headers: ctx.auth(director.body.accessToken) })
    ).json() as MeResponseDto;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/switch",
      headers: ctx.auth(body.accessToken),
      payload: { membershipId: directorMe.current.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it("si una escuela le quita el acceso, conserva el de la otra", async () => {
    const directorA = await ctx.tokenFor("director@escuela-coxen-hole.hn");
    await ctx.app.inject({
      method: "POST",
      url: `/users/${maestra.id}/status`,
      headers: ctx.auth(directorA),
      payload: { active: false },
    });
    const { res, body } = await ctx.login("maestra@ihb.hn", PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(body.user.schoolId).toBe(schoolIds["escuela-french-harbour"]);
    const me = (
      await ctx.app.inject({ url: "/me", headers: ctx.auth(body.accessToken) })
    ).json() as MeResponseDto;
    expect(me.memberships).toHaveLength(1);
  });

  it("identity informa todos sus roles en un centro (para validar docentes desde otros servicios)", async () => {
    const directorB = await ctx.tokenFor("director@escuela-french-harbour.hn");
    await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(directorB),
      payload: { name: "Maestra Mejía", email: "maestra@ihb.hn", password: PASSWORD, role: "coordinador" },
    });
    const res = await ctx.app.inject({ url: `/users/${maestra.id}`, headers: ctx.auth(directorB) });
    expect(res.json().roles.sort()).toEqual(["coordinador", "docente"]);
  });
});
