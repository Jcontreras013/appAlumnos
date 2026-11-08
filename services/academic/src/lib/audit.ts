import type { FastifyRequest } from "fastify";
import type { DbOrTx } from "../db/client";
import { auditEvents } from "../db/schema";

/** Se llama dentro de la misma transacción que el cambio: o quedan los dos, o ninguno. */
export async function audit(
  db: DbOrTx,
  request: FastifyRequest,
  event: { action: string; entityType?: string; entityId?: string; data?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditEvents).values({
    schoolId: request.auth.schoolId,
    actorUserId: request.auth.userId,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    data: event.data ?? null,
    requestId: request.id,
  });
}
