import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb, runMigrations } from "./db/client";
import { loadSigningKeys } from "./lib/keys";
import { sendPendingNotices } from "./lib/messages";
import { webPushSender } from "./lib/push";

const config = loadConfig();

if (config.runMigrationsOnStart) {
  await runMigrations(config.databaseUrl);
}

const { db, pool } = createDb(config.databaseUrl);
const keys = await loadSigningKeys({
  keyId: config.jwtKeyId,
  privateKeyPem: config.jwtPrivateKeyPem,
  publicKeyPem: config.jwtPublicKeyPem,
});
const push = config.vapid ? webPushSender(config.vapid) : null;
const app = await buildApp({ db, keys, settings: config, push });

// Avisos de los mensajes que llegaron fuera del horario de atención: se revisa cada 5 minutos y se
// manda al empezar la jornada.
const notices = push
  ? setInterval(
      () => {
        sendPendingNotices(db, push, new Date()).catch((err) =>
          app.log.error({ err }, "No se enviaron los avisos pendientes de mensajes"),
        );
      },
      5 * 60 * 1000,
    )
  : null;

// Apagado ordenado: ECS manda SIGTERM antes de matar la tarea en cada despliegue.
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    if (closing) return;
    closing = true;
    if (notices) clearInterval(notices);
    app.log.info({ signal }, "Cerrando el servicio");
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
