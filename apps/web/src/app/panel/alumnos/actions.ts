"use server";

import {
  createStudentInputSchema,
  enrollInputSchema,
  guardianInputSchema,
  guardianUpdateSchema,
  type ImportResultDto,
  type PortalAccessDto,
  portalAccessInputSchema,
  studentFieldsSchema,
  withdrawInputSchema,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError, runFormAction } from "@/lib/forms";
import { readStudentSpreadsheet, SpreadsheetError } from "@/lib/spreadsheet";

const writer = () => requireRole("admin", "secretaria");

const STUDENT_FIELDS = [
  "firstNames",
  "lastNames",
  "nationalId",
  "birthDate",
  "sex",
  "medicalNotes",
  "notes",
] as const;
const GUARDIAN_FIELDS = ["fullName", "relationship", "nationalId", "phone", "email"] as const;

const guardianFrom = (values: Record<string, string>, prefix: string) =>
  Object.fromEntries(GUARDIAN_FIELDS.map((f) => [f, values[`${prefix}${f}`]]));

export async function createStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  const fields = [...STUDENT_FIELDS, ...GUARDIAN_FIELDS.map((f) => `guardian.${f}`), "sectionId"];
  const values = formValues(formData, fields);
  const parsed = createStudentInputSchema.safeParse({
    ...Object.fromEntries(STUDENT_FIELDS.map((f) => [f, values[f]])),
    guardians: [{ ...guardianFrom(values, "guardian."), isPrimary: true }],
    sectionId: values.sectionId,
  });
  if (!parsed.success) {
    const state = fromZodError(parsed.error);
    // "guardians.0.phone" => "guardian.phone" (nombre del campo en el formulario)
    const renamed = Object.entries(state.fields ?? {}).map(([k, v]) => [
      k.replace(/^guardians\.0\./, "guardian."),
      v,
    ]);
    return { ...state, fields: Object.fromEntries(renamed), values };
  }

  let studentId: string;
  try {
    studentId = (await academic.createStudent(accessToken, parsed.data)).id;
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
  revalidatePath("/panel/alumnos");
  redirect(`/panel/alumnos/${studentId}?nuevo=1`);
}

export async function updateStudentAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: studentFieldsSchema,
    fields: STUDENT_FIELDS,
    submit: async (input) => {
      await academic.updateStudent(accessToken, id, input);
      revalidatePath(`/panel/alumnos/${id}`);
      return "Datos guardados.";
    },
  });
}

export async function addGuardianAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: guardianInputSchema,
    fields: [...GUARDIAN_FIELDS, "isPrimary"],
    build: (v) => ({ ...guardianFrom(v, ""), isPrimary: v.isPrimary === "on" }),
    submit: async (input) => {
      await academic.addGuardian(accessToken, id, input);
      revalidatePath(`/panel/alumnos/${id}`);
      return `${input.fullName} agregado como responsable.`;
    },
  });
}

const guardianTarget = z.object({ studentId: z.uuid(), guardianId: z.uuid() });

/** Corregir los datos de un responsable (valen para todos sus hijos en el centro) y su parentesco. */
export async function updateGuardianAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  const { studentId, guardianId } = guardianTarget.parse({
    studentId: formData.get("studentId"),
    guardianId: formData.get("id"),
  });
  return runFormAction(formData, {
    schema: guardianUpdateSchema,
    fields: GUARDIAN_FIELDS,
    submit: async (input) => {
      await academic.updateGuardian(accessToken, studentId, guardianId, input);
      revalidatePath(`/panel/alumnos/${studentId}`);
      return `Datos de ${input.fullName} guardados.`;
    },
  });
}

export async function setPrimaryGuardianAction(formData: FormData) {
  const { accessToken } = await writer();
  const { studentId, guardianId } = guardianTarget.parse(Object.fromEntries(formData));
  await academic.setPrimaryGuardian(accessToken, studentId, guardianId);
  revalidatePath(`/panel/alumnos/${studentId}`);
}

export async function removeGuardianAction(formData: FormData) {
  const { accessToken } = await writer();
  const { studentId, guardianId } = guardianTarget.parse(Object.fromEntries(formData));
  await academic.removeGuardian(accessToken, studentId, guardianId);
  revalidatePath(`/panel/alumnos/${studentId}`);
}

export async function enrollAction(
  studentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: enrollInputSchema,
    fields: ["sectionId"],
    build: (v) => ({ studentId, sectionId: v.sectionId }),
    submit: async (input) => {
      const detail = await academic.enroll(accessToken, input.studentId, input.sectionId);
      revalidatePath(`/panel/alumnos/${studentId}`);
      return `Matriculado en ${detail.enrollments[0]?.sectionLabel ?? "la sección"}.`;
    },
  });
}

export async function transferAction(
  target: { studentId: string; enrollmentId: string },
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: z.object({ sectionId: z.uuid({ error: "Elige la sección" }) }),
    fields: ["sectionId"],
    submit: async ({ sectionId }) => {
      const detail = await academic.transfer(accessToken, target.enrollmentId, sectionId);
      revalidatePath(`/panel/alumnos/${target.studentId}`);
      return `Cambiado a ${detail.enrollments[0]?.sectionLabel ?? "la nueva sección"}.`;
    },
  });
}

export async function withdrawAction(
  target: { studentId: string; enrollmentId: string },
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: withdrawInputSchema,
    fields: ["withdrawnOn", "reason"],
    submit: async ({ withdrawnOn, reason }) => {
      await academic.withdraw(accessToken, target.enrollmentId, withdrawnOn, reason);
      revalidatePath(`/panel/alumnos/${target.studentId}`);
      return "Retiro registrado.";
    },
  });
}

// ───────────────────────────── Importación ─────────────────────────────

export interface ImportState {
  error?: string;
  result?: ImportResultDto;
  /** Filas ya leídas del archivo, para confirmar sin volver a subirlo. */
  payload?: string;
  fileName?: string;
}

export async function previewImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { accessToken } = await writer();
  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige un archivo .xlsx o .csv" };
  try {
    const rows = await readStudentSpreadsheet(file);
    if (rows.length === 0) return { error: "El archivo no tiene alumnos debajo de los encabezados" };
    const result = await academic.importStudents(accessToken, rows, true);
    return { result, payload: JSON.stringify(rows), fileName: file.name };
  } catch (err) {
    if (err instanceof SpreadsheetError) return { error: err.message };
    return { error: fromServiceError(err).error };
  }
}

export async function confirmImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { accessToken } = await writer();
  const rows = z
    .array(z.record(z.string(), z.string()))
    .safeParse(JSON.parse(String(formData.get("payload") ?? "[]")));
  if (!rows.success || rows.data.length === 0) return { error: "Vuelve a subir el archivo" };
  let created: number;
  try {
    created = (await academic.importStudents(accessToken, rows.data, false)).created;
  } catch (err) {
    if (err instanceof ServiceError && err.code === "import_has_errors") {
      // Algo cambió entre la vista previa y la confirmación (p. ej. alguien llenó una sección)
      return {
        error: err.message,
        result: err.details as ImportResultDto,
        payload: String(formData.get("payload")),
      };
    }
    return { error: fromServiceError(err).error };
  }
  revalidatePath("/panel/alumnos");
  redirect(`/panel/alumnos?importados=${created}`);
}

export interface PortalAccessState extends FormState {
  access?: PortalAccessDto;
}

/** Portal de familias desde la ficha: dar acceso, nueva contraseña temporal o quitar el acceso. */
export async function portalAccessAction(
  _prev: PortalAccessState,
  formData: FormData,
): Promise<PortalAccessState> {
  const { accessToken } = await requireRole("admin", "secretaria");
  const studentId = z.uuid().parse(formData.get("studentId"));
  const guardianId = z.uuid().parse(formData.get("guardianId"));
  const intent = String(formData.get("intent") ?? "dar");
  try {
    if (intent === "quitar") {
      await academic.revokePortalAccess(accessToken, guardianId);
      revalidatePath(`/panel/alumnos/${studentId}`);
      return { ok: true, message: "Se quitó el acceso al portal." };
    }
    if (intent === "restablecer") {
      const access = await academic.resetPortalAccess(accessToken, guardianId);
      revalidatePath(`/panel/alumnos/${studentId}`);
      return { ok: true, access };
    }
    const values = formValues(formData, ["nationalId", "email"]);
    const parsed = portalAccessInputSchema.safeParse(values);
    if (!parsed.success) return { ...fromZodError(parsed.error), values };
    const access = await academic.grantPortalAccess(accessToken, guardianId, parsed.data);
    revalidatePath(`/panel/alumnos/${studentId}`);
    return { ok: true, access };
  } catch (err) {
    return fromServiceError(err);
  }
}
