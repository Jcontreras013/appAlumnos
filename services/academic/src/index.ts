import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db/client";
import { httpIdentityClient } from "./lib/identity-client";
import { claudePlanDrafter, type PlanDrafter } from "./lib/plan-assistant";
import { geminiPlanDrafter } from "./lib/plan-assistant-gemini";

const config = loadConfig();

if (config.runMigrationsOnStart) {
  await runMigrations(config.databaseUrl);
}

const { db, pool } = createDb(config.databaseUrl);
const assistant = config.planAssistant;
const planDrafter: PlanDrafter | null = !assistant
  ? null
  : assistant.provider === "gemini"
    ? geminiPlanDrafter({ apiKey: assistant.apiKey, model: assistant.model })
    : claudePlanDrafter();
const app = await buildApp({
  db,
  identity: httpIdentityClient(config.identityUrl),
  identityUrl: config.identityUrl,
  planDrafter,
});
if (assistant) {
  app.log.info(
    { provider: assistant.provider, model: assistant.provider === "gemini" ? assistant.model : undefined },
    "Asistente de planificación activo",
  );
} else if (config.planAssistantWarning) {
  app.log.warn(config.planAssistantWarning);
}

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
