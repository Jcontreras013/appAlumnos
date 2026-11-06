import { resolve } from "node:path";
import { optionalEnv } from "@escolar/service-kit";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

/** Funciona igual con node-postgres (producción) y con PGlite (tests). */
// biome-ignore lint/suspicious/noExplicitAny: el tipo de resultado depende del driver
export type Db = PgDatabase<any, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function migrationsFolder(): string {
  return optionalEnv("MIGRATIONS_DIR", resolve(process.cwd(), "drizzle"));
}

/**
 * Separa `sslmode` de la URL y lo traduce a la opción `ssl` de node-postgres (si se dejan los dos,
 * el driver da prioridad a la URL y la configuración real queda ambigua).
 * - local (docker compose): sin sslmode => sin TLS.
 * - RDS: sslmode=require => TLS obligatorio. El tráfico nunca sale de la VPC.
 */
function poolConfig(databaseUrl: string): pg.PoolConfig {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    max: 10,
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: sslmode === "verify-full" } : undefined,
  };
}

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool(poolConfig(databaseUrl));
  const db = drizzle(pool, { schema });
  return { db: db as Db, pool };
}

/**
 * Corre las migraciones pendientes protegidas con un advisory lock de Postgres, para que si se
 * levantan varias réplicas del servicio a la vez (despliegue en ECS) solo una migre.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { pool } = createDb(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('escolar_identity_migrations'))");
    await migrate(drizzle(client, { schema }), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('escolar_identity_migrations'))").catch(() => {});
    client.release();
    await pool.end();
  }
}

export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
