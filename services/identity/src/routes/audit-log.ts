import { parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import type { AuditEventDto } from "@escolar/shared";
import { and, desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditEvents } from "../db/schema";
import type { IdentityDeps } from "../deps";

const query = z.object({
  antes: z.iso.datetime({ error: "Fecha inválida" }).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

/** Bitácora del centro, de la más reciente a la más antigua (paginada con `antes`). Solo la dirección. */
export async function auditLogRoutes(app: FastifyInstance, { db }: IdentityDeps) {
  app.get(
    "/audit",
    { preHandler: [app.authenticate, requireRole("admin")] },
    async (request): Promise<AuditEventDto[]> => {
      const schoolId = tenantOf(request);
      const { antes, limite } = parseOrThrow(query, request.query);
      const rows = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.schoolId, schoolId),
            antes ? lt(auditEvents.createdAt, new Date(antes)) : undefined,
          ),
        )
        .orderBy(desc(auditEvents.createdAt))
        .limit(limite);
      return rows.map((r) => ({
        id: r.id,
        source: "identity",
        action: r.action,
        actorUserId: r.actorUserId,
        entityType: r.entityType,
        entityId: r.entityId,
        data: (r.data as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    },
  );
}
