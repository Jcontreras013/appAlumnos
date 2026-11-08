import {
  createDb as createServiceDb,
  runMigrations as runServiceMigrations,
  type ServiceDb,
} from "@escolar/service-kit";
import * as schema from "./schema";

export { migrationsFolder, ping } from "@escolar/service-kit";

export type Db = ServiceDb<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(databaseUrl: string) {
  return createServiceDb(databaseUrl, schema);
}

export function runMigrations(databaseUrl: string) {
  return runServiceMigrations(databaseUrl, { lockName: "escolar_identity_migrations", createDatabase: true });
}
