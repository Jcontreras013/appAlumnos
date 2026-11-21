/**
 * Genera las llaves de los avisos al celular (Web Push, VAPID). Se pasa el correo (o la página web)
 * de quien opera la plataforma: Apple y Google lo piden para poder contactar si hay un problema.
 *   Local:  pnpm push:keys soporte@dominio.hn >> services/identity/.env
 *   AWS:    pnpm -s push:keys soporte@dominio.hn --json > push.json
 *           aws secretsmanager create-secret --name escolar/dev/push --secret-string file://push.json
 *           rm push.json
 */
import { generateVapidKeys } from "../lib/push";

const contact = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!contact) {
  console.error("Indica el correo de contacto: pnpm push:keys soporte@dominio.hn");
  process.exit(1);
}
const subject = contact.startsWith("https://") ? contact : `mailto:${contact.replace(/^mailto:/, "")}`;
const keys = generateVapidKeys();

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: subject,
    }),
  );
} else {
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log(`VAPID_SUBJECT=${subject}`);
}
