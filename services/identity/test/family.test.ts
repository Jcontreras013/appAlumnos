import type { CreatedUserDto, FamilyAccountDto, MeResponseDto, UserDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let admin: string;
let secretaria: string;
let otherAdmin: string;
let docenteId: string;

beforeAll(async () => {
  ctx = await setupIdentity();
  const school = await ctx.createSchool("escuela-familias");
  const other = await ctx.createSchool("otra-escuela");
  admin = school.adminToken;
  otherAdmin = other.adminToken;
  const post = (url: string, payload: object, token = admin) =>
    ctx.app.inject({ method: "POST", url, headers: ctx.auth(token), payload });
  await post("/users", {
    name: "Sofía Secretaria",
    email: "secretaria@familias.hn",
    password: PASSWORD,
    role: "secretaria",
  });
  secretaria = await ctx.tokenFor("secretaria@familias.hn");
  docenteId = (
    await post("/users", {
      name: "Doña Docente",
      email: "docente@familias.hn",
      password: PASSWORD,
      role: "docente",
    })
  ).json<CreatedUserDto>().id;
});
afterAll(() => ctx.close());

const grant = (payload: object, token = secretaria) =>
  ctx.app.inject({ method: "POST", url: "/family-accounts", headers: ctx.auth(token), payload });

describe("cuentas de familias", () => {
  let account: FamilyAccountDto;

  it("la secretaría crea la cuenta de una madre sin correo: entra con su identidad y una clave temporal", async () => {
    const res = await grant({ name: "María López", nationalId: "0801-1985-01234" });
    expect(res.statusCode).toBe(200);
    account = res.json();
    expect(account).toMatchObject({ login: "0801-1985-01234", linkedExisting: false });
    expect(account.temporaryPassword).toMatch(/^[A-Za-z]+-\d{4}-[A-Za-z]+$/);

    const login = await ctx.login("0801198501234", account.temporaryPassword as string);
    expect(login.res.statusCode).toBe(200);
    expect(login.body.user).toMatchObject({ role: "padre", mustChangePassword: true, email: null });
  });

  it("dar acceso otra vez no crea otra cuenta ni cambia su contraseña", async () => {
    const again = (
      await grant({ name: "María López", nationalId: "0801198501234" })
    ).json<FamilyAccountDto>();
    expect(again).toMatchObject({ userId: account.userId, linkedExisting: true, temporaryPassword: null });
  });

  it("al cambiar la contraseña temporal ya no se pide cambiarla y la temporal deja de servir", async () => {
    const token = await ctx.tokenFor("0801-1985-01234", account.temporaryPassword as string);
    const change = (payload: object) =>
      ctx.app.inject({ method: "POST", url: "/auth/password", headers: ctx.auth(token), payload });
    expect(
      (await change({ currentPassword: "otra-cosa-123", newPassword: "nueva-clave-segura" })).statusCode,
    ).toBe(403);
    expect(
      (await change({ currentPassword: account.temporaryPassword, newPassword: "corta" })).statusCode,
    ).toBe(400);
    expect(
      (await change({ currentPassword: account.temporaryPassword, newPassword: "nueva-clave-segura" }))
        .statusCode,
    ).toBe(204);

    expect((await ctx.login("0801198501234", account.temporaryPassword as string)).res.statusCode).toBe(401);
    const fresh = await ctx.tokenFor("0801198501234", "nueva-clave-segura");
    const me = (
      await ctx.app.inject({ method: "GET", url: "/me", headers: ctx.auth(fresh) })
    ).json<MeResponseDto>();
    expect(me.user.mustChangePassword).toBe(false);
  });

  it("si la persona ya trabaja en la escuela, solo se le agrega el acceso de familia", async () => {
    const res = (
      await grant({ name: "Doña Docente", email: "docente@familias.hn" })
    ).json<FamilyAccountDto>();
    expect(res).toMatchObject({ userId: docenteId, linkedExisting: true, temporaryPassword: null });
    // Su contraseña no la restablece la secretaría: también es personal.
    const reset = await ctx.app.inject({
      method: "POST",
      url: `/family-accounts/${docenteId}/reset-password`,
      headers: ctx.auth(secretaria),
    });
    expect(reset.statusCode).toBe(403);
  });

  it("una identidad y un correo de cuentas distintas no se mezclan", async () => {
    const res = await grant({ name: "Mezcla", nationalId: "0801198501234", email: "docente@familias.hn" });
    expect(res.statusCode).toBe(409);
  });

  it("restablecer la contraseña de una familia da otra temporal y cierra sus sesiones", async () => {
    const reset = await ctx.app.inject({
      method: "POST",
      url: `/family-accounts/${account.userId}/reset-password`,
      headers: ctx.auth(secretaria),
    });
    const body = reset.json<FamilyAccountDto>();
    expect(body.temporaryPassword).toBeTruthy();
    expect((await ctx.login("0801198501234", "nueva-clave-segura")).res.statusCode).toBe(401);
    expect(
      (await ctx.login("0801198501234", body.temporaryPassword as string)).body.user.mustChangePassword,
    ).toBe(true);
  });

  it("otro centro no restablece ni quita el acceso de esta familia", async () => {
    const reset = await ctx.app.inject({
      method: "POST",
      url: `/family-accounts/${account.userId}/reset-password`,
      headers: ctx.auth(otherAdmin),
    });
    expect(reset.statusCode).toBe(404);
  });

  it("un docente no crea cuentas de familia", async () => {
    const docente = await ctx.tokenFor("docente@familias.hn");
    expect((await grant({ name: "Alguien", nationalId: "0801199900001" }, docente)).statusCode).toBe(403);
  });

  it("las familias no aparecen en la lista del personal", async () => {
    const staff = (await ctx.app.inject({ method: "GET", url: "/users", headers: ctx.auth(admin) })).json<
      UserDto[]
    >();
    expect(staff.some((u) => u.role === "padre")).toBe(false);
    const families = (
      await ctx.app.inject({ method: "GET", url: "/users?role=padre", headers: ctx.auth(admin) })
    ).json<UserDto[]>();
    expect(families.map((u) => u.name)).toContain("María López");
  });

  it("quitar el acceso: la familia ya no puede entrar a este centro", async () => {
    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/family-accounts/${account.userId}`,
      headers: ctx.auth(secretaria),
    });
    expect(del.statusCode).toBe(204);
    const reset = await ctx.app.inject({
      method: "POST",
      url: `/family-accounts/${account.userId}/reset-password`,
      headers: ctx.auth(secretaria),
    });
    expect(reset.statusCode).toBe(404);
  });
});
