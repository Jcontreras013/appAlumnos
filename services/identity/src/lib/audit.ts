import type { FastifyRequest } from "fastify";
import type { DbOrTx } from "../db/client";
import { auditEvents } from "../db/schema";

export interface AuditEvent {
  action: string;
  schoolId?: string | null;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/**
 * Registra un evento en la bitácora. Se llama dentro de la misma transacción que el cambio
 * auditado: o quedan guardados los dos, o ninguno.
 */
export async function audit(db: DbOrTx, request: FastifyRequest | null, event: AuditEvent): Promise<void> {
  await db.insert(auditEvents).values({
    action: event.action,
    schoolId: event.schoolId ?? null,
    actorUserId: event.actorUserId ?? null,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    data: event.data ?? null,
    ip: request?.ip ?? null,
    requestId: request?.id ?? null,
  });
}
