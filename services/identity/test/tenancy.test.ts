import type { UserDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let schoolA: { schoolId: string; adminToken: string };
let schoolB: { schoolId: string; adminToken: string };

beforeAll(async () => {
  ctx = await setupIdentity();
  schoolA = await ctx.createSchool("colegio-a");
  schoolB = await ctx.createSchool("colegio-b");
});
afterAll(() => ctx.close());

async function createUser(adminToken: string, email: string, role = "docente") {
  return ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(adminToken),
    payload: { name: "Usuario de prueba", email, password: PASSWORD, role },
  });
}

describe("colegios (solo superadmin)", () => {
  it("un admin de colegio no puede listar ni crear colegios", async () => {
    expect(
      (await ctx.app.inject({ url: "/schools", headers: ctx.auth(schoolA.adminToken) })).statusCode,
    ).toBe(403);
  });

  it("rechaza un identificador de colegio repetido con 409", async () => {
    const token = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/schools",
      headers: ctx.auth(token),
      payload: {
        name: "Otro",
        slug: "colegio-a",
        admin: { name: "Admin", email: "otro@x.hn", password: PASSWORD },
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("una misma persona puede dirigir dos centros con una sola cuenta", async () => {
    const token = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/schools",
      headers: ctx.auth(token),
      payload: {
        name: "Escuela Vespertina",
        slug: "escuela-vespertina",
        admin: { name: "Admin", email: "admin@colegio-a.hn", password: "otra-clave-que-se-ignora" },
      },
    });
    expect(res.statusCode).toBe(201);
    // Conserva su contraseña: la que se escribió al crear el segundo centro no la reemplaza
    expect((await ctx.login("admin@colegio-a.hn", "otra-clave-que-se-ignora")).res.statusCode).toBe(401);
    const { body } = await ctx.login("admin@colegio-a.hn", PASSWORD);
    const me = (await ctx.app.inject({ url: "/me", headers: ctx.auth(body.accessToken) })).json();
    expect(me.memberships).toHaveLength(2);
  });
});

describe("aislamiento entre colegios", () => {
  it("cada admin solo ve los usuarios de su colegio", async () => {
    await createUser(schoolA.adminToken, "docente@colegio-a.hn");
    await createUser(schoolB.adminToken, "docente@colegio-b.hn");

    const listA = (await ctx.app.inject({ url: "/users", headers: ctx.auth(schoolA.adminToken) })).json();
    const emailsA = listA.map((u: UserDto) => u.email);
    expect(emailsA).toContain("docente@colegio-a.hn");
    expect(emailsA).not.toContain("docente@colegio-b.hn");
    expect(listA.every((u: UserDto) => u.schoolId === schoolA.schoolId)).toBe(true);
  });

  it("el colegio sale del token, no del body: no se puede crear un usuario en otro colegio", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(schoolA.adminToken),
      payload: {
        name: "Intruso",
        email: "intruso@colegio-b.hn",
        password: PASSWORD,
        role: "docente",
        schoolId: schoolB.schoolId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().schoolId).toBe(schoolA.schoolId);
  });

  it("un admin no puede desactivar a un usuario de otro colegio (404, sin revelar que existe)", async () => {
    const victim = (await createUser(schoolB.adminToken, "victima@colegio-b.hn")).json() as UserDto;
    const res = await ctx.app.inject({
      method: "POST",
      url: `/users/${victim.id}/status`,
      headers: ctx.auth(schoolA.adminToken),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(404);
    const stillActive = await ctx.login("victima@colegio-b.hn", PASSWORD);
    expect(stillActive.res.statusCode).toBe(200);
  });

  it("no se puede crear un superadmin desde un colegio", async () => {
    const res = await createUser(schoolA.adminToken, "falso-root@colegio-a.hn", "superadmin");
    expect(res.statusCode).toBe(400);
  });

  it("roles sin permiso reciben 403", async () => {
    await createUser(schoolA.adminToken, "padre@colegio-a.hn", "padre");
    const parentToken = await ctx.tokenFor("padre@colegio-a.hn");
    expect((await ctx.app.inject({ url: "/users", headers: ctx.auth(parentToken) })).statusCode).toBe(403);
    expect((await createUser(parentToken, "otro@colegio-a.hn")).statusCode).toBe(403);
  });

  it("dar dos veces el mismo acceso en el mismo centro da 409", async () => {
    const res = await createUser(schoolA.adminToken, "docente@colegio-a.hn");
    expect(res.statusCode).toBe(409);
  });
});

describe("desactivación", () => {
  it("un usuario desactivado ya no puede iniciar sesión ni refrescar su sesión", async () => {
    const user = (await createUser(schoolA.adminToken, "temporal@colegio-a.hn")).json() as UserDto;
    const session = await ctx.login("temporal@colegio-a.hn", PASSWORD);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/users/${user.id}/status`,
      headers: ctx.auth(schoolA.adminToken),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);

    // Contraseña correcta pero sin ningún acceso activo: 403 con mensaje claro
    expect((await ctx.login("temporal@colegio-a.hn", PASSWORD)).res.statusCode).toBe(403);
    const refresh = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.body.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it("el admin no puede desactivarse a sí mismo", async () => {
    const me = (await ctx.app.inject({ url: "/me", headers: ctx.auth(schoolA.adminToken) })).json();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/users/${me.user.id}/status`,
      headers: ctx.auth(schoolA.adminToken),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("desactivar un colegio bloquea el login de su personal", async () => {
    const school = await ctx.createSchool("colegio-cerrado");
    const root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
    await ctx.app.inject({
      method: "POST",
      url: `/schools/${school.schoolId}/status`,
      headers: ctx.auth(root),
      payload: { active: false },
    });
    const { res } = await ctx.login("admin@colegio-cerrado.hn", PASSWORD);
    expect(res.statusCode).toBe(403);
  });

  it("ids mal formados devuelven 400, no un error de base de datos", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/users/no-es-un-uuid/status",
      headers: ctx.auth(schoolA.adminToken),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("lectura de usuarios para coordinación", () => {
  it("coordinación lista docentes de su colegio pero no puede crear usuarios", async () => {
    await createUser(schoolA.adminToken, "coordinacion@colegio-a.hn", "coordinador");
    const coordToken = await ctx.tokenFor("coordinacion@colegio-a.hn");

    const res = await ctx.app.inject({ url: "/users?role=docente", headers: ctx.auth(coordToken) });
    expect(res.statusCode).toBe(200);
    const list = res.json() as UserDto[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((u) => u.role === "docente" && u.schoolId === schoolA.schoolId)).toBe(true);

    expect((await createUser(coordToken, "nuevo@colegio-a.hn")).statusCode).toBe(403);
  });

  it("consultar un usuario de otro colegio por id da 404", async () => {
    const otro = (await createUser(schoolB.adminToken, "docente-x@colegio-b.hn")).json() as UserDto;
    const res = await ctx.app.inject({ url: `/users/${otro.id}`, headers: ctx.auth(schoolA.adminToken) });
    expect(res.statusCode).toBe(404);
    const own = await ctx.app.inject({ url: `/users/${otro.id}`, headers: ctx.auth(schoolB.adminToken) });
    expect(own.json()).toMatchObject({ id: otro.id, role: "docente" });
  });
});
