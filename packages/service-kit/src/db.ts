import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import { optionalEnv } from "./config";

/** Base de datos de un servicio. Funciona igual con node-postgres (producción) y PGlite (tests). */
// biome-ignore lint/suspicious/noExplicitAny: el tipo de resultado depende del driver
export type ServiceDb<TSchema extends Record<string, unknown>> = PgDatabase<any, TSchema>;

export function migrationsFolder(): string {
  return optionalEnv("MIGRATIONS_DIR", resolve(process.cwd(), "drizzle"));
}

/**
 * Separa `sslmode` de la URL y lo traduce a la opción `ssl` de node-postgres (si se dejan los dos,
 * el driver da prioridad a la URL y la configuración real queda ambigua).
 * - local (docker compose): sin sslmode => sin TLS.
 * - RDS: sslmode=require => TLS obligatorio. El tráfico nunca sale de la VPC.
 */
export function poolConfig(databaseUrl: string): pg.PoolConfig {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    max: 10,
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: sslmode === "verify-full" } : undefined,
  };
}

export function createDb<TSchema extends Record<string, unknown>>(databaseUrl: string, schema: TSchema) {
  const pool = new pg.Pool(poolConfig(databaseUrl));
  return { db: drizzle(pool, { schema }) as ServiceDb<TSchema>, pool };
}

/**
 * Cada microservicio tiene su propia base de datos dentro del mismo servidor Postgres.
 * Si no existe (primer despliegue en RDS), se crea. Dos réplicas arrancando a la vez no son problema:
 * la segunda recibe "ya existe" y sigue.
 */
export async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`Nombre de base de datos inválido: ${name}`);
  }
  url.pathname = "/postgres";
  const client = new pg.Client(poolConfig(url.toString()));
  await client.connect();
  try {
    const existing = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) {
      await client.query(`create database "${name}"`).catch((err: { code?: string }) => {
        if (err.code !== "42P04") throw err; // duplicate_database: otra réplica la creó primero
      });
    }
  } finally {
    await client.end();
  }
}

/**
 * Corre las migraciones pendientes protegidas con un advisory lock de Postgres, para que si se
 * levantan varias réplicas del servicio a la vez (despliegue en ECS) solo una migre.
 */
export async function runMigrations(
  databaseUrl: string,
  options: { lockName: string; createDatabase?: boolean },
): Promise<void> {
  if (options.createDatabase) await ensureDatabaseExists(databaseUrl);
  const client = new pg.Client(poolConfig(databaseUrl));
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [options.lockName]);
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [options.lockName]).catch(() => {});
    await client.end();
  }
}

export async function ping(db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }) {
  await db.execute(sql`select 1`);
}
