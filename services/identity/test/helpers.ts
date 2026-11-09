import { PGlite } from "@electric-sql/pglite";
import type { LoginResponseDto } from "@escolar/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildApp } from "../src/app";
import { DEFAULT_TOKEN_SETTINGS, type TokenSettings } from "../src/config";
import { type Db, migrationsFolder } from "../src/db/client";
import * as schema from "../src/db/schema";
import { generateSigningKeys } from "../src/lib/keys";
import { grantAccess } from "../src/lib/users";

export const SUPERADMIN = { email: "root@plataforma.test", password: "superadmin-segura-123" };
export const PASSWORD = "contraseña-de-prueba-1";

/**
 * Levanta el servicio completo contra un Postgres real en memoria (PGlite) con las migraciones
 * reales. No necesita Docker ni una base externa, así que corre igual en local y en CI.
 */
export async function setupIdentity(settings: Partial<TokenSettings> = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client, { schema }), { migrationsFolder: migrationsFolder() });

  const keys = await generateSigningKeys("test-key");
  const app = await buildApp({
    db,
    keys,
    settings: { ...DEFAULT_TOKEN_SETTINGS, ...settings, loginRateLimitPerMinute: 1000 },
    logger: false,
  });
  await grantAccess(db, { name: "Root", role: "superadmin", ...SUPERADMIN });

  async function login(email: string, password: string) {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    return { res, body: res.json() as LoginResponseDto };
  }

  async function tokenFor(email: string, password = PASSWORD) {
    const { res, body } = await login(email, password);
    if (res.statusCode !== 200) throw new Error(`Login falló para ${email}: ${res.body}`);
    return body.accessToken;
  }

  /** Crea un colegio con su administrador usando la API, como lo haría el equipo de la plataforma. */
  async function createSchool(slug: string) {
    const token = await tokenFor(SUPERADMIN.email, SUPERADMIN.password);
    const res = await app.inject({
      method: "POST",
      url: "/schools",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: `Colegio ${slug}`,
        slug,
        rtn: "0801-1990-123456",
        admin: { name: "Admin", email: `admin@${slug}.hn`, password: PASSWORD },
      },
    });
    if (res.statusCode !== 201) throw new Error(`No se creó el colegio: ${res.body}`);
    const body = res.json() as { school: { id: string } };
    return { schoolId: body.school.id, adminToken: await tokenFor(`admin@${slug}.hn`) };
  }

  return {
    app,
    db,
    client,
    keys,
    login,
    tokenFor,
    createSchool,
    auth: (token: string) => ({ authorization: `Bearer ${token}` }),
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}

export type IdentityTestContext = Awaited<ReturnType<typeof setupIdentity>>;
