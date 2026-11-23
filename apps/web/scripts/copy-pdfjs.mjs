/*
 * Copia a public/pdfjs/<versión>/ lo que el lector de PDF de la biblioteca carga aparte: el worker,
 * las fuentes estándar, los mapas de caracteres y los decodificadores de imágenes. Con la versión en
 * la ruta, el teléfono que lo guardó para leer sin internet nunca mezcla archivos de dos versiones.
 * Corre antes de `next dev` y `next build`; la carpeta no va en git.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "pdfjs");
const target = join(root, version);

if (existsSync(root)) {
  for (const old of readdirSync(root))
    if (old !== version) rmSync(join(root, old), { recursive: true, force: true });
}
if (!existsSync(join(target, "pdf.worker.min.mjs"))) {
  mkdirSync(target, { recursive: true });
  cpSync(join(source, "build", "pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs"));
  for (const folder of ["cmaps", "standard_fonts", "iccs"]) {
    cpSync(join(source, folder), join(target, folder), { recursive: true });
  }
  mkdirSync(join(target, "wasm"), { recursive: true });
  for (const file of readdirSync(join(source, "wasm"))) {
    if (file.endsWith(".wasm") || file.endsWith(".js") || file.startsWith("LICENSE")) {
      cpSync(join(source, "wasm", file), join(target, "wasm", file));
    }
  }
  cpSync(join(source, "LICENSE"), join(target, "LICENSE"));
  console.log(`Lector de PDF: archivos de pdf.js ${version} copiados a public/pdfjs/${version}`);
}
