"use server";

import { CONDUCT_MEASURE_LABELS, incidentInputSchema, measureInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { fromServiceError, runFormAction } from "@/lib/forms";

const refresh = (studentId: string) => {
  revalidatePath("/panel/conducta");
  revalidatePath(`/panel/alumnos/${studentId}`);
};

/** Reportar un incidente (maestro, coordinación o dirección). */
export async function reportIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador", "docente");
  return runFormAction(formData, {
    schema: incidentInputSchema,
    fields: ["studentId", "date", "severity", "category", "description"],
    submit: async (input) => {
      const created = await academic.reportIncident(accessToken, input);
      refresh(input.studentId);
      return `Incidente de ${created.studentName} registrado.`;
    },
  });
}

/** Registrar una medida. La expulsión pide confirmar que se retira la matrícula. */
export async function addMeasureAction(
  target: { incidentId: string; studentId: string },
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador");
  if (formData.get("kind") === "expulsion" && formData.get("confirm") !== "on") {
    return {
      error: "Para registrar la expulsión, confirma que se retira la matrícula del alumno.",
      fields: { confirm: "Confirma la expulsión" },
      values: Object.fromEntries(
        ["kind", "startsOn", "endsOn", "notes"].map((k) => [k, String(formData.get(k) ?? "")]),
      ),
    };
  }
  return runFormAction(formData, {
    schema: measureInputSchema,
    fields: ["kind", "startsOn", "endsOn", "notes"],
    submit: async (input) => {
      await academic.addMeasure(accessToken, target.incidentId, input);
      refresh(target.studentId);
      return input.kind === "expulsion"
        ? "Expulsión registrada. Se retiró la matrícula del alumno."
        : `${CONDUCT_MEASURE_LABELS[input.kind]} registrada.`;
    },
  });
}

/** Anular una medida registrada por error (solo la dirección). */
export async function cancelMeasureAction(
  target: { measureId: string; studentId: string },
  _prev: FormState,
): Promise<FormState> {
  const { accessToken } = await requireRole("admin");
  try {
    await academic.cancelMeasure(accessToken, target.measureId);
    refresh(target.studentId);
    return { ok: true, message: "Medida anulada." };
  } catch (err) {
    return fromServiceError(err);
  }
}

/** Borrar un reporte hecho por error, mientras no tenga medidas. */
export async function deleteIncidentAction(
  target: { incidentId: string; studentId: string },
  _prev: FormState,
): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador", "docente");
  try {
    await academic.deleteIncident(accessToken, target.incidentId);
    refresh(target.studentId);
    return { ok: true, message: "Reporte borrado." };
  } catch (err) {
    return fromServiceError(err);
  }
}
