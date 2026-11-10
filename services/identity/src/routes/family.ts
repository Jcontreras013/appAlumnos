import { randomInt } from "node:crypto";
import { conflict, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import { type FamilyAccountDto, familyAccountInputSchema, formatNationalId } from "@escolar/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { memberships, type User, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { hashPassword, temporaryPassword } from "../lib/passwords";
import { provisionAccount } from "../lib/users";

const idParams = z.object({ id: z.uuid() });

const loginOf = (user: Pick<User, "email" | "nationalId">, prefer?: "nationalId" | "email") =>
  prefer === "email" && user.email
    ? user.email
    : user.nationalId
      ? formatNationalId(user.nationalId)
      : (user.email ?? "");

async function familyMembership(db: DbOrTx, userId: string, schoolId: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.role, "padre"), eq(memberships.schoolId, schoolId)),
    );
  return row;
}

/**
 * Cuentas del portal de familias. Las crea la secretaría o la dirección del centro (normalmente
 * desde la ficha del alumno, a través de academic). Si la persona ya tiene cuenta (por ejemplo, es
 * maestra en otra escuela o tiene hijos en otro centro) solo se le agrega el acceso de familia.
 */
export async function familyRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };

  app.post("/family-accounts", guard, async (request): Promise<FamilyAccountDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(familyAccountInputSchema, request.body);
    return db.transaction(async (tx) => {
      const result = await provisionAccount(tx, {
        name: input.name,
        email: input.email,
        nationalId: input.nationalId,
        role: "padre",
        schoolId,
      });
      await audit(tx, request, {
        action: "family_account.granted",
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

  /** Nueva contraseña temporal para una familia que olvidó la suya. */
  app.post("/family-accounts/:id/reset-password", guard, async (request): Promise<FamilyAccountDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const all = await db.select().from(memberships).where(eq(memberships.userId, id));
    if (!all.some((m) => m.role === "padre" && m.schoolId === schoolId && m.active)) {
      throw notFound("Cuenta de familia no encontrada");
    }
    // Una cuenta que también es de personal (de este u otro centro) no la restablece la secretaría.
    if (all.some((m) => m.role !== "padre")) {
      throw forbidden(
        "Esta persona también trabaja en un centro: su contraseña la cambia ella misma desde su cuenta.",
      );
    }
    const password = temporaryPassword();
    const user = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      await tokens.revokeAllForUser(tx, id);
      await audit(tx, request, {
        action: "family_account.password_reset",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: id,
      });
      return updated;
    });
    if (!user) throw notFound("Cuenta de familia no encontrada");
    return { userId: id, login: loginOf(user), temporaryPassword: password, linkedExisting: true };
  });

  /** Quitar el acceso de familia en este centro (la cuenta sigue si tiene otros accesos). */
  app.delete("/family-accounts/:id", guard, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const membership = await familyMembership(db, id, schoolId);
    if (membership?.active) {
      await db.transaction(async (tx) => {
        await tx
          .update(memberships)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(memberships.id, membership.id));
        await tokens.revokeForMembership(tx, membership.id);
        await audit(tx, request, {
          action: "family_account.revoked",
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
