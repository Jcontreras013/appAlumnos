import type { CreatedUserDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nameParts, usernameCandidates } from "../src/lib/usernames";
import { type IdentityTestContext, PASSWORD, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let school: { schoolId: string; adminToken: string };

beforeAll(async () => {
  ctx = await setupIdentity();
  school = await ctx.createSchool("escuela-usuarios");
});
afterAll(() => ctx.close());

const create = (payload: Record<string, unknown>) =>
  ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(school.adminToken),
    payload: { password: PASSWORD, role: "docente", ...payload },
  });

describe("usuario automático del personal", () => {
  it("se arma con la inicial del nombre y el primer apellido, sin tildes", () => {
    expect(usernameCandidates(nameParts({ name: "Lucía Paz Mejía" })).slice(0, 3)).toEqual([
      "lpaz",
      "lpazm",
      "lpazmejia",
    ]);
    expect(nameParts({ name: "x", firstNames: "Rosa María", lastNames: "De la Cruz Núñez" })).toEqual({
      first: "rosa",
      last1: "cruz",
      last2: "nunez",
    });
    expect(nameParts({ name: "José Andrés Castillo Ñuñez" })).toEqual({
      first: "jose",
      last1: "castillo",
      last2: "nunez",
    });
  });

  it("el maestro nuevo recibe su usuario y entra con él, sin correo ni identidad", async () => {
    const res = await create({ name: "Lucía Paz Mejía", firstNames: "Lucía", lastNames: "Paz Mejía" });
    expect(res.statusCode).toBe(201);
    const user = res.json<CreatedUserDto>();
    expect(user).toMatchObject({ username: "lpaz", email: null, nationalId: null });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "LPaz", password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it("si el nombre se repite, se guía por el segundo apellido y después por un número", async () => {
    const second = await create({ name: "Luis Paz Martínez", email: "luis@escuela.hn" });
    expect(second.json<CreatedUserDto>().username).toBe("lpazm");
    const third = await create({ name: "Lorena Paz Mendoza" });
    expect(third.json<CreatedUserDto>().username).toBe("lpazmendoza");
    const fourth = await create({ name: "Laura Paz" });
    expect(fourth.json<CreatedUserDto>().username).toBe("lpaz2");
  });

  it("las cuentas de familias no reciben usuario y siguen pidiendo correo o identidad", async () => {
    const res = await create({ name: "Sin Datos", role: "padre" });
    expect(res.statusCode).toBe(400);
  });
});
