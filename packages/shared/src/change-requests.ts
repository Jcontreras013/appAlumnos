import { z } from "zod";

/*
 * Solicitudes de la secretaría: crear un grado, una sección o una materia, o registrar el permiso
 * (licencia) de un maestro. No se aplican hasta que la dirección las confirma; la secretaría le manda
 * un mensaje a la dirección cada vez.
 */

export const CHANGE_REQUEST_KINDS = ["grado", "seccion", "materia", "licencia"] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export const CHANGE_REQUEST_STATUSES = ["pendiente", "aprobada", "rechazada"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  pendiente: "Por confirmar",
  aprobada: "Confirmada",
  rechazada: "Rechazada",
};

/** Lo que manda la secretaría: qué quiere crear y sus datos (los mismos de cada formulario). */
export const changeRequestInputSchema = z.object({
  kind: z.enum(CHANGE_REQUEST_KINDS, { error: "Tipo de solicitud desconocido" }),
  payload: z.record(z.string(), z.unknown()),
});
export type ChangeRequestInput = z.infer<typeof changeRequestInputSchema>;

export const rejectChangeRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export interface ChangeRequestDto {
  id: string;
  kind: ChangeRequestKind;
  /** En palabras: «Crear el grado «Octavo grado»». */
  summary: string;
  status: ChangeRequestStatus;
  requestedByName: string;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  /** Por qué se rechazó (si la dirección lo escribió). */
  decisionNote: string | null;
}
