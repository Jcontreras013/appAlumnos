import "server-only";
import { buildXlsx, type Sheet } from "./xlsx";

/** "Escuela Demo West End" → "escuela-demo-west-end" (para nombres de archivo). */
export const fileSlug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Respuesta de descarga de un libro de Excel. No se guarda en caché: son datos personales. */
export function xlsxResponse(filename: string, sheets: Sheet[]): Response {
  return new Response(buildXlsx(sheets) as BodyInit, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
