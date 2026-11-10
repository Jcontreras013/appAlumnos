import "server-only";
import { IMPORT_COLUMNS, type ImportColumn, mapHeaders, parseCsv } from "@escolar/shared";
import { readSheet } from "read-excel-file/node";

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export class SpreadsheetError extends Error {}

/** Columnas con número de identidad: Excel les quita el cero inicial y hay que devolvérselo. */
const ID_COLUMNS = new Set<string>(["identidad", "identidad_responsable", "identidad_director"]);

/** Convierte una celda de Excel a texto como lo escribiría una persona. */
function cellToText(value: unknown, column: string | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Excel guarda fechas sin zona horaria: se leen en UTC para no correr un día.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const text = String(value);
    // Excel convierte "0801201500001" en el número 801201500001 y se come el cero inicial.
    if (column && ID_COLUMNS.has(column) && /^\d{12}$/.test(text)) return `0${text}`;
    return text;
  }
  return String(value).trim();
}

function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // CSV guardado desde Excel en Windows sin UTF-8
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Alumnos con su responsable (importación de matrícula). */
export function readStudentSpreadsheet(file: File): Promise<Record<string, string>[]> {
  return readSpreadsheet(file, IMPORT_COLUMNS);
}

/**
 * Lee un .xlsx o .csv y devuelve las filas con las columnas reconocidas.
 * Lanza SpreadsheetError con un mensaje para la persona si el archivo no sirve.
 */
export async function readSpreadsheet<K extends string>(
  file: File,
  columns: readonly ImportColumn<K>[],
): Promise<Record<string, string>[]> {
  if (file.size === 0) throw new SpreadsheetError("El archivo está vacío");
  if (file.size > MAX_IMPORT_BYTES) throw new SpreadsheetError("El archivo pesa más de 4 MB");

  const name = file.name.toLowerCase();
  const bytes = await file.arrayBuffer();
  let table: unknown[][];
  if (name.endsWith(".csv")) {
    table = parseCsv(decodeText(bytes));
  } else if (name.endsWith(".xlsx")) {
    try {
      table = (await readSheet(Buffer.from(bytes))) as unknown[][];
    } catch {
      throw new SpreadsheetError(
        "No se pudo leer el Excel. Guárdalo de nuevo como .xlsx e inténtalo otra vez.",
      );
    }
  } else {
    throw new SpreadsheetError("Sube un archivo .xlsx o .csv");
  }

  const [headerRow, ...dataRows] = table;
  if (!headerRow) throw new SpreadsheetError("El archivo no tiene encabezados");
  const { mapping, missing } = mapHeaders(
    columns,
    headerRow.map((h) => String(h ?? "")),
  );
  if (missing.length) {
    throw new SpreadsheetError(`Faltan columnas obligatorias: ${missing.join(", ")}. Usa la plantilla.`);
  }

  return dataRows
    .map((cells) => {
      const row: Record<string, string> = {};
      for (const column of columns) {
        const index = mapping[column.key];
        if (index !== undefined) row[column.key] = cellToText(cells[index], column.key);
      }
      return row;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));
}
