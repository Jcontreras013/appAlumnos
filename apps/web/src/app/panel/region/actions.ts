"use server";

import { SCHOOL_IMPORT_COLUMNS } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { fromServiceError } from "@/lib/forms";
import { identity } from "@/lib/identity";
import type { AccountImportState } from "@/lib/import-state";
import { readSpreadsheet, SpreadsheetError } from "@/lib/spreadsheet";

export async function previewSchoolImportAction(
  _prev: AccountImportState,
  formData: FormData,
): Promise<AccountImportState> {
  const { accessToken } = await requireRole("director_departamental");
  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige un archivo .xlsx o .csv" };
  try {
    const rows = await readSpreadsheet(file, SCHOOL_IMPORT_COLUMNS);
    if (rows.length === 0) return { error: "El archivo no tiene centros debajo de los encabezados" };
    const result = await identity.importSchools(accessToken, rows, true);
    return { result, payload: JSON.stringify(rows), fileName: file.name };
  } catch (err) {
    if (err instanceof SpreadsheetError) return { error: err.message };
    return { error: fromServiceError(err).error };
  }
}

export async function confirmSchoolImportAction(
  _prev: AccountImportState,
  formData: FormData,
): Promise<AccountImportState> {
  const { accessToken } = await requireRole("director_departamental");
  const rows = z
    .array(z.record(z.string(), z.string()))
    .safeParse(JSON.parse(String(formData.get("payload") ?? "[]")));
  if (!rows.success || rows.data.length === 0) return { error: "Vuelve a subir el archivo" };
  try {
    const result = await identity.importSchools(accessToken, rows.data, false);
    revalidatePath("/panel/region");
    return { result };
  } catch (err) {
    if (err instanceof ServiceError && err.code === "import_has_errors") {
      return {
        error: err.message,
        result: err.details as AccountImportState["result"],
        payload: String(formData.get("payload")),
      };
    }
    return { error: fromServiceError(err).error };
  }
}
