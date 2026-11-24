import { defaultFilesDir, localFileStore, s3FileStore } from "@escolar/service-kit";
import { buildApp } from "./app";
import type { PlanAssistantConfig } from "./config";
import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db/client";
import { httpIdentityClient } from "./lib/identity-client";
import { causeChain, claudePlanDrafter, fallbackPlanDrafter, type PlanDrafter } from "./lib/plan-assistant";
import { geminiPlanDrafter } from "./lib/plan-assistant-gemini";
import { groqPlanDrafter } from "./lib/plan-assistant-groq";

const config = loadConfig();

if (config.runMigrationsOnStart) {
  await runMigrations(config.databaseUrl);
}

const { db, pool } = createDb(config.databaseUrl);
const assistant = config.planAssistant;
const drafterFor = (settings: PlanAssistantConfig): PlanDrafter =>
  settings.provider === "gemini"
    ? geminiPlanDrafter({ apiKey: settings.apiKey, model: settings.model })
    : settings.provider === "groq"
      ? groqPlanDrafter({ apiKey: settings.apiKey, model: settings.model })
      : claudePlanDrafter();
const planDrafter: PlanDrafter | null = !assistant
  ? null
  : fallbackPlanDrafter(
      [assistant, ...config.planAssistantBackups].map((s) => ({ name: s.provider, drafter: drafterFor(s) })),
      {
        onFallback: (from, to, err) =>
          app.log.warn(
            { from, to, detail: causeChain(err instanceof Error ? (err.cause ?? err) : err) },
            "El asistente principal falló; se usa el de respaldo",
          ),
      },
    );
const files =
  config.files.kind === "s3"
    ? s3FileStore(config.files.bucket)
    : localFileStore(config.files.dir ?? defaultFilesDir(".biblioteca"));
const app = await buildApp({
  db,
  files,
  identity: httpIdentityClient(config.identityUrl),
  identityUrl: config.identityUrl,
  planDrafter,
});
if (assistant) {
  app.log.info(
    {
      provider: assistant.provider,
      model: assistant.provider === "claude" ? undefined : assistant.model,
      backups: config.planAssistantBackups.map((b) => b.provider),
    },
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
