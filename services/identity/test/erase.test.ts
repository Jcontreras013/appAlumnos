import type { AccountLookupDto, CreatedUserDto, FamilyAccountDto, UserDto } from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditEvents,
  memberships,
  pushDevices,
  pushSubscriptions,
  refreshTokens,
  users,
} from "../src/db/schema";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let root: string;
let admin: string;
let secretaria: string;
let docente: CreatedUserDto;

const post = (url: string, token: string, payload?: object) =>
  ctx.app.inject({ method: "POST", url, headers: ctx.auth(token), ...(payload ? { payload } : {}) });
const lookup = (token: string, login: string) => post("/accounts/lookup", token, { login });
const erase = (token: string, id: string) => post(`/accounts/${id}/erase`, token);

beforeAll(async () => {
  ctx = await setupIdentity();
  root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const school = await ctx.createSchool("escuela-borrar");
  admin = school.adminToken;
  await post("/users", admin, {
    name: "Sara Secretaria",
    email: "secretaria@borrar.hn",
    password: PASSWORD,
    role: "secretaria",
  });
  secretaria = await ctx.tokenFor("secretaria@borrar.hn");
  docente = (
    await post("/users", admin, {
      name: "Diana Docente",
      email: "docente@borrar.hn",
      password: PASSWORD,
      role: "docente",
    })
  ).json<CreatedUserDto>();
});
afterAll(() => ctx.close());

describe("eliminar una cuenta a pedido de la persona", () => {
  it("el equipo de la plataforma busca la cuenta y ve de quién es y dónde tiene acceso", async () => {
    const res = await lookup(root, "Docente@Borrar.hn");
    expect(res.statusCode).toBe(200);
    expect(res.json<AccountLookupDto>()).toEqual({
      id: docente.id,
      name: "Diana Docente",
      login: "docente@borrar.hn",
      platformTeam: false,
      accesses: [{ role: "docente", place: "Colegio escuela-borrar", active: true }],
    });
    expect((await lookup(root, "nadie@borrar.hn")).statusCode).toBe(404);
    expect((await lookup(root, SUPERADMIN.email)).json<AccountLookupDto>().platformTeam).toBe(true);
  });

  it("solo el equipo de la plataforma: ni la dirección ni la secretaría", async () => {
    expect((await lookup(admin, "docente@borrar.hn")).statusCode).toBe(403);
    expect((await erase(admin, docente.id)).statusCode).toBe(403);
    expect((await erase(secretaria, docente.id)).statusCode).toBe(403);
  });

  it("no se elimina la propia cuenta ni la de otra persona del equipo", async () => {
    const [me] = await ctx.db.select().from(users).where(eq(users.email, SUPERADMIN.email));
    expect((await erase(root, me?.id as string)).statusCode).toBe(403);
    const otro = await post("/users", admin, {
      name: "Otro",
      email: "otro@borrar.hn",
      password: PASSWORD,
      role: "docente",
    });
    const otroId = otro.json<CreatedUserDto>().id;
    await ctx.db.insert(memberships).values({ userId: otroId, role: "superadmin" });
    expect((await erase(root, otroId)).statusCode).toBe(403);
  });

  it("borra con qué entraba, la contraseña, las sesiones y los avisos; la fila queda para el registro", async () => {
    const session = await ctx.login("docente@borrar.hn", PASSWORD);
    expect(session.res.statusCode).toBe(200);
    await ctx.db
      .insert(pushSubscriptions)
      .values({ userId: docente.id, endpoint: "https://push/1", p256dh: "k", auth: "a" });
    await ctx.db.insert(pushDevices).values({ userId: docente.id, token: "fcm-token-1" });

    expect((await erase(root, docente.id)).statusCode).toBe(204);

    const [user] = await ctx.db.select().from(users).where(eq(users.id, docente.id));
    expect(user).toMatchObject({
      name: "Cuenta eliminada",
      email: null,
      nationalId: null,
      active: false,
      totpSecret: null,
    });
    expect(user?.deletedAt).toBeInstanceOf(Date);
    const own = await ctx.db.select().from(memberships).where(eq(memberships.userId, docente.id));
    expect(own.every((m) => !m.active)).toBe(true);
    const tokens = await ctx.db.select().from(refreshTokens).where(eq(refreshTokens.userId, docente.id));
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    expect(
      await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, docente.id)),
    ).toEqual([]);
    expect(await ctx.db.select().from(pushDevices).where(eq(pushDevices.userId, docente.id))).toEqual([]);

    // Ya no entra ni renueva su sesión.
    expect((await ctx.login("docente@borrar.hn", PASSWORD)).res.statusCode).toBe(401);
    const refresh = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.body.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    // La bitácora dice qué pasó, sin nada que identifique a la persona.
    const [event] = await ctx.db.select().from(auditEvents).where(eq(auditEvents.action, "account.erased"));
    expect(event).toMatchObject({ entityId: docente.id, data: { roles: ["docente"] } });
    expect(JSON.stringify(event)).not.toContain("borrar.hn");
  });

  it("ya no aparece en el personal ni se puede reactivar; eliminarla otra vez avisa", async () => {
    const staff = (await ctx.app.inject({ method: "GET", url: "/users", headers: ctx.auth(admin) })).json<
      UserDto[]
    >();
    expect(staff.some((u) => u.id === docente.id)).toBe(false);
    const reactivate = await post(`/users/${docente.id}/status`, admin, { active: true });
    expect(reactivate.statusCode).toBe(409);
    expect((await erase(root, docente.id)).statusCode).toBe(409);
    expect((await lookup(root, "docente@borrar.hn")).statusCode).toBe(404);
  });

  it("con el mismo correo se le puede crear una cuenta nueva si vuelve", async () => {
    const again = await post("/users", admin, {
      name: "Diana Docente",
      email: "docente@borrar.hn",
      password: PASSWORD,
      role: "docente",
    });
    expect(again.statusCode).toBe(201);
    expect(again.json<CreatedUserDto>()).toMatchObject({ linkedExisting: false });
    expect(again.json<CreatedUserDto>().id).not.toBe(docente.id);
  });

  it("la cuenta de una familia (sin correo, con identidad) también se elimina", async () => {
    const family = (
      await post("/family-accounts", secretaria, { name: "Marta Madre", nationalId: "0801-1980-55555" })
    ).json<FamilyAccountDto>();
    const found = (await lookup(root, "0801198055555")).json<AccountLookupDto>();
    expect(found).toMatchObject({ id: family.userId, login: "0801-1980-55555" });
    expect((await erase(root, family.userId)).statusCode).toBe(204);
    expect((await ctx.login("0801198055555", family.temporaryPassword as string)).res.statusCode).toBe(401);
    // La secretaría ya no le puede dar una contraseña nueva a esa cuenta…
    const reset = await post(`/family-accounts/${family.userId}/reset-password`, secretaria);
    expect(reset.statusCode).toBe(404);
    // …pero sí una cuenta nueva con la misma identidad.
    const fresh = (
      await post("/family-accounts", secretaria, { name: "Marta Madre", nationalId: "0801-1980-55555" })
    ).json<FamilyAccountDto>();
    expect(fresh.userId).not.toBe(family.userId);
    expect(fresh.linkedExisting).toBe(false);
  });
});
