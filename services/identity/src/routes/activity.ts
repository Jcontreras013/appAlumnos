import { requireRole } from "@escolar/service-kit";
import type { ScopeActivityDto } from "@escolar/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { memberships, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { schoolsInScope } from "./regions";

/**
 * Qué cuentas se usan de verdad en los centros del ámbito (para los indicadores del piloto). Una
 * cuenta "en uso" ya entró con su contraseña y cambió la temporal que le entregaron.
 */
export async function activityRoutes(app: FastifyInstance, { db }: IdentityDeps) {
  app.get(
    "/scope/activity",
    {
      preHandler: [
        app.authenticate,
        requireRole("director_departamental", "director_distrital", "superadmin"),
      ],
    },
    async (request): Promise<ScopeActivityDto> => {
      const scope = await schoolsInScope(db, request);
      const ids = scope.map((s) => s.id);
      if (ids.length === 0) return { schools: [], activatedFamilyUserIds: [] };
      const rows = await db
        .select({ schoolId: memberships.schoolId, role: memberships.role, userId: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            inArray(memberships.schoolId, ids),
            inArray(memberships.role, ["admin", "secretaria", "padre"]),
            eq(memberships.active, true),
            eq(users.active, true),
            isNotNull(users.lastLoginAt),
            eq(users.mustChangePassword, false),
          ),
        );
      const has = (schoolId: string, role: string) =>
        rows.some((r) => r.schoolId === schoolId && r.role === role);
      return {
        schools: ids.map((schoolId) => ({
          schoolId,
          directorActive: has(schoolId, "admin"),
          secretaryActive: has(schoolId, "secretaria"),
        })),
        activatedFamilyUserIds: [...new Set(rows.filter((r) => r.role === "padre").map((r) => r.userId))],
      };
    },
  );
}
