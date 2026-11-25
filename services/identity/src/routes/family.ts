import { forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type FamilyAccountDto,
  familyAccountInputSchema,
  formatNationalId,
  type PortalRole,
} from "@escolar/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { memberships, type User } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { provisionAccount, resetToTemporary } from "../lib/users";

const idParams = z.object({ id: z.uuid() });

const loginOf = (user: Pick<User, "email" | "nationalId">, prefer?: "nationalId" | "email") =>
  prefer === "email" && user.email
    ? user.email
    : user.nationalId
      ? formatNationalId(user.nationalId)
      : (user.email ?? "");

async function portalMembership(db: DbOrTx, userId: string, schoolId: string, role: PortalRole) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.role, role), eq(memberships.schoolId, schoolId)),
    );
  return row;
}

interface PortalKind {
  role: PortalRole;
  /** Ruta base: /family-accounts o /student-accounts. */
  path: string;
  /** Prefijo de las acciones de la bitácora: family_account.* o student_account.* */
  auditPrefix: "family_account" | "student_account";
  notFoundMessage: string;
}

const KINDS: PortalKind[] = [
  {
    role: "padre",
    path: "/family-accounts",
    auditPrefix: "family_account",
    notFoundMessage: "Cuenta de familia no encontrada",
  },
  {
    role: "estudiante",
    path: "/student-accounts",
    auditPrefix: "student_account",
    notFoundMessage: "Cuenta de alumno no encontrada",
  },
];

/**
 * Cuentas del portal: familias (padre, madre o encargado) y alumnos. Las crea la secretaría o la
 * dirección del centro desde la ficha del alumno (a través de academic). Si la persona ya tiene
 * cuenta (por ejemplo, es maestra en otra escuela o tiene hijos en otro centro) solo se le agrega
 * este acceso.
 */
export async function familyRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };

  for (const kind of KINDS) {
    app.post(kind.path, guard, async (request): Promise<FamilyAccountDto> => {
      const schoolId = tenantOf(request);
      const input = parseOrThrow(familyAccountInputSchema, request.body);
      return db.transaction(async (tx) => {
        const result = await provisionAccount(tx, {
          name: input.name,
          email: input.email,
          nationalId: input.nationalId,
          role: kind.role,
          schoolId,
        });
        await audit(tx, request, {
          action: `${kind.auditPrefix}.granted`,
          schoolId,
          actorUserId: request.auth.userId,
          entityType: "user",
          entityId: result.user.id,
          data: { linkedExisting: result.linkedExisting },
        });
        return {
          userId: result.user.id,
          login: loginOf(result.user, input.nationalId ? "nationalId" : "email"),
          temporaryPassword: result.temporaryPassword,
          linkedExisting: result.linkedExisting,
        };
      });
    });

    /** Nueva contraseña temporal para quien olvidó la suya. */
    app.post(`${kind.path}/:id/reset-password`, guard, async (request): Promise<FamilyAccountDto> => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      const all = await db.select().from(memberships).where(eq(memberships.userId, id));
      if (!all.some((m) => m.role === kind.role && m.schoolId === schoolId && m.active)) {
        throw notFound(kind.notFoundMessage);
      }
      // Una cuenta que también es de personal (de este u otro centro) no la restablece la secretaría.
      if (all.some((m) => m.role !== kind.role)) {
        throw forbidden(
          "Esta persona también tiene otro acceso: su contraseña la cambia ella misma desde su cuenta.",
        );
      }
      const { user, temporaryPassword: password } = await db.transaction(async (tx) => {
        const result = await resetToTemporary(tx, id);
        await tokens.revokeAllForUser(tx, id);
        await audit(tx, request, {
          action: `${kind.auditPrefix}.password_reset`,
          schoolId,
          actorUserId: request.auth.userId,
          entityType: "user",
          entityId: id,
        });
        return result;
      });
      return { userId: id, login: loginOf(user), temporaryPassword: password, linkedExisting: true };
    });

    /** Quitar este acceso en el centro (la cuenta sigue si tiene otros). */
    app.delete(`${kind.path}/:id`, guard, async (request, reply) => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      const membership = await portalMembership(db, id, schoolId, kind.role);
      if (membership?.active) {
        await db.transaction(async (tx) => {
          await tx
            .update(memberships)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(memberships.id, membership.id));
          await tokens.revokeForMembership(tx, membership.id);
          await audit(tx, request, {
            action: `${kind.auditPrefix}.revoked`,
            schoolId,
            actorUserId: request.auth.userId,
            entityType: "user",
            entityId: id,
          });
        });
      }
      return reply.status(204).send();
    });
  }
}
