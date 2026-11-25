/*
 * Después de `cap sync`: deja a la pantalla de «sin conexión» la dirección de CONECTA (la misma que
 * abre la app, server.url), para que «Volver a intentar» la vuelva a abrir.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "src", "main", "assets");
const config = JSON.parse(readFileSync(join(assets, "capacitor.config.json"), "utf8"));
const url = config.server?.url;
if (typeof url !== "string" || !/^https?:\/\//.test(url))
  throw new Error("capacitor.config.json sin server.url");
writeFileSync(join(assets, "public", "conecta-url.js"), `window.CONECTA_URL = ${JSON.stringify(url)};\n`);
console.log(`App de CONECTA: abre ${url}`);

// Sin google-services.json la app no tiene Firebase, y el módulo de avisos (PushNotifications) cierra
// la app de golpe si se le llama. Se quita de la app: la plataforma ve que no hay avisos del teléfono
// y no muestra la opción.
const plugins = join(assets, "capacitor.plugins.json");
const firebase = join(assets, "..", "..", "..", "google-services.json");
if (!existsSync(firebase)) {
  const list = JSON.parse(readFileSync(plugins, "utf8"));
  const sinAvisos = list.filter((p) => p.pkg !== "@capacitor/push-notifications");
  writeFileSync(plugins, `${JSON.stringify(sinAvisos, null, "\t")}\n`);
  console.log("Sin google-services.json: la app va sin avisos del teléfono (Firebase).");
}
