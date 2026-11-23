/*
 * Después de `cap sync`: deja a la pantalla de «sin conexión» la dirección de CONECTA (la misma que
 * abre la app, server.url), para que «Volver a intentar» la vuelva a abrir.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "android", "app", "src", "main", "assets");
const config = JSON.parse(readFileSync(join(assets, "capacitor.config.json"), "utf8"));
const url = config.server?.url;
if (typeof url !== "string" || !/^https?:\/\//.test(url))
  throw new Error("capacitor.config.json sin server.url");
writeFileSync(join(assets, "public", "conecta-url.js"), `window.CONECTA_URL = ${JSON.stringify(url)};\n`);
console.log(`App de CONECTA: abre ${url}`);
