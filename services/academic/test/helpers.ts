import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  createAccessTokenVerifier,
  JWT_ALGORITHM,
} from "@escolar/service-kit";
import type { Role, UserDto } from "@escolar/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../src/app";
import { type Db, migrationsFolder } from "../src/db/client";
import * as schema from "../src/db/schema";
import type { IdentityClient } from "../src/lib/identity-client";

export interface TestUser {
  id: string;
  schoolId: string;
  role: Role;
  name: string;
  token: string;
}

/**
 * Levanta academic contra un Postgres real en memoria (PGlite) con las migraciones reales.
 * Los tokens se firman con una llave generada aquí, igual que lo hace identity en producción,
 * y identity se reemplaza por un doble que responde con los usuarios registrados en el test.
 */
export async function setupAcademic(options: { today?: string } = {}) {
  const client = new PGlite();
  await migrate(drizzle(client, { schema }), { migrationsFolder: migrationsFolder() });
  const db = drizzle(client, { schema }) as unknown as Db;

  const keys = await generateKeyPair(JWT_ALGORITHM);
  const directory = new Map<string, UserDto>();
  const identity: IdentityClient = {
    async getUser(_token, userId) {
      return directory.get(userId) ?? null;
    },
  };

  let today = options.today ?? "2026-11-09";
  const app = await buildApp({
    db,
    identity,
    verifier: await createAccessTokenVerifier({ publicKey: keys.publicKey }),
    today: () => today,
    logger: false,
  });

  async function user(role: Role, schoolId: string, name = `${role} de prueba`): Promise<TestUser> {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role, school_id: schoolId, name })
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setSubject(id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(keys.privateKey);
    directory.set(id, {
      id,
      schoolId,
      name,
      email: `${id}@test.hn`,
      role,
      active: true,
      createdAt: new Date().toISOString(),
    });
    return { id, schoolId, role, name, token };
  }

  const call = async <T = unknown>(
    who: TestUser,
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${who.token}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: res.statusCode, body: (res.body ? res.json() : null) as T, raw: res };
  };

  /** Crea año vigente, un grado con dos secciones (A con cupo, B sin límite) y una materia. */
  async function seedStructure(admin: TestUser, opts: { capacityA?: number | null } = {}) {
    const year = (
      await call<{ id: string }>(admin, "POST", "/school-years", {
        name: "2026",
        startsOn: "2026-02-02",
        endsOn: "2026-11-27",
      })
    ).body;
    const grade = (
      await call<{ id: string }>(admin, "POST", "/grades", { name: "Primer grado", sortOrder: 1 })
    ).body;
    const sectionA = (
      await call<{ id: string }>(admin, "POST", "/sections", {
        schoolYearId: year.id,
        gradeId: grade.id,
        name: "A",
        capacity: opts.capacityA === undefined ? 30 : opts.capacityA,
      })
    ).body;
    const sectionB = (
      await call<{ id: string }>(admin, "POST", "/sections", {
        schoolYearId: year.id,
        gradeId: grade.id,
        name: "B",
        capacity: "",
      })
    ).body;
    const subject = (await call<{ id: string }>(admin, "POST", "/subjects", { name: "Matemáticas" })).body;
    return { year, grade, sectionA, sectionB, subject };
  }

  return {
    app,
    db,
    user,
    call,
    seedStructure,
    directory,
    setToday: (value: string) => {
      today = value;
    },
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}

export const guardian = (overrides: Record<string, unknown> = {}) => ({
  fullName: "María López Castro",
  relationship: "madre",
  phone: "9988-7766",
  ...overrides,
});

export type AcademicTestContext = Awaited<ReturnType<typeof setupAcademic>>;
