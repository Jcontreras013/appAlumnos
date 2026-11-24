import { z } from "zod";
import type { PlanContent } from "./academic";

/*
 * Asistente de planificación: a partir del tema de la semana (y lo que el docente quiera indicar),
 * arma un borrador con los campos de la plantilla del centro. No guarda nada: el borrador llena el
 * formulario y el docente lo revisa, lo ajusta y lo guarda como cualquier planificación.
 */

/** Borradores por docente y por día (cada uno cuesta una llamada al modelo). */
export const PLAN_DRAFTS_PER_DAY = 20;

const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

export const planDraftInputSchema = z.object({
  topic: z
    .string({ error: "Escribe el tema de la semana" })
    .trim()
    .min(3, { error: "Escribe el tema de la semana" })
    .max(200, { error: "Máximo 200 caracteres" }),
  /** Lo que el docente quiera que se tome en cuenta: libro de texto, materiales, alumnos con dificultades… */
  notes: z.preprocess(
    blankToUndefined,
    z.string().trim().max(1000, { error: "Máximo 1000 caracteres" }).optional(),
  ),
});
export type PlanDraftInput = z.infer<typeof planDraftInputSchema>;

export interface PlanDraftDto {
  content: PlanContent;
  /** Cuántos borradores le quedan hoy al docente. */
  remainingToday: number;
}

export interface PlanAssistantStatusDto {
  /** Si la instalación tiene el asistente configurado. */
  enabled: boolean;
  remainingToday: number;
  dailyLimit: number;
}
