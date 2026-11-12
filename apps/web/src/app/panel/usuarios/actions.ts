"use server";

import {
  createUserInputSchema,
  formatNationalId,
  ROLE_LABELS,
  roleChangeSchema,
  STAFF_IMPORT_COLUMNS,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError, runFormAction } from "@/lib/forms";
import { identity } from "@/lib/identity";
import type { AccountImportState } from "@/lib/import-state";
import { readSpreadsheet, SpreadsheetError } from "@/lib/spreadsheet";

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  const values = formValues(formData, ["name", "nationalId", "email", "role"]);
  const parsed = createUserInputSchema.safeParse({ ...values, password: formData.get("password") });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };

  try {
    const user = await identity.createUser(session.accessToken, parsed.data);
    revalidatePath("/panel/usuarios");
    return {
      ok: true,
      message: user.linkedExisting
        ? `${user.name} ya tenía cuenta (trabaja en otro centro): se le dio acceso a este como ${ROLE_LABELS[user.role]}, con su misma contraseña.`
        : user.temporaryPassword
          ? `Se creó la cuenta de ${user.name} (${ROLE_LABELS[user.role]}). Entra con ${user.nationalId ? formatNationalId(user.nationalId) : user.email} y la contraseña temporal ${user.temporaryPassword} (la cambiará al entrar). Anótala: no se vuelve a mostrar.`
          : `Se creó la cuenta de ${user.name} (${ROLE_LABELS[user.role]}).`,
    };
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
}

const toggleSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

export async function setUserActiveAction(formData: FormData) {
  const session = await requireRole("admin");
  const { id, active } = toggleSchema.parse({ id: formData.get("id"), active: formData.get("active") });
  await identity.setUserActive(session.accessToken, id, active === "true");
  revalidatePath("/panel/usuarios");
}

// ── Carga del personal desde Excel ──
const payloadRows = (formData: FormData) =>
  z.array(z.record(z.string(), z.string())).safeParse(JSON.parse(String(formData.get("payload") ?? "[]")));

export async function previewStaffImportAction(
  _prev: AccountImportState,
  formData: FormData,
): Promise<AccountImportState> {
  const { accessToken } = await requireRole("admin");
  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige un archivo .xlsx o .csv" };
  try {
    const rows = await readSpreadsheet(file, STAFF_IMPORT_COLUMNS);
    if (rows.length === 0) return { error: "El archivo no tiene personas debajo de los encabezados" };
    const result = await identity.importStaff(accessToken, rows, true);
    return { result, payload: JSON.stringify(rows), fileName: file.name };
  } catch (err) {
    if (err instanceof SpreadsheetError) return { error: err.message };
    return { error: fromServiceError(err).error };
  }
}

export async function confirmStaffImportAction(
  _prev: AccountImportState,
  formData: FormData,
): Promise<AccountImportState> {
  const { accessToken } = await requireRole("admin");
  const rows = payloadRows(formData);
  if (!rows.success || rows.data.length === 0) return { error: "Vuelve a subir el archivo" };
  try {
    const result = await identity.importStaff(accessToken, rows.data, false);
    revalidatePath("/panel/usuarios");
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

/** Cambiar el cargo de alguien en este centro (un acceso a la vez). */
export async function changeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  return runFormAction(formData, {
    schema: roleChangeSchema,
    fields: ["from", "to"],
    submit: async (input) => {
      const user = await identity.changeRole(session.accessToken, id, input);
      revalidatePath("/panel/usuarios");
      return `${user.name} ahora es ${ROLE_LABELS[user.role]}.`;
    },
  });
}
