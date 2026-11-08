import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db/client";
import { httpIdentityClient } from "./lib/identity-client";

const config = loadConfig();

if (config.runMigrationsOnStart) {
  await runMigrations(config.databaseUrl);
}

const { db, pool } = createDb(config.databaseUrl);
const app = await buildApp({
  db,
  identity: httpIdentityClient(config.identityUrl),
  identityUrl: config.identityUrl,
});

// Apagado ordenado: ECS manda SIGTERM antes de matar la tarea en cada despliegue.
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Cerrando el servicio");
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
