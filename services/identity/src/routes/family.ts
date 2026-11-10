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
import { hashPassword } from "../lib/passwords";

const idParams = z.object({ id: z.uuid() });

// Palabras sin tildes ni eñes: la contraseña temporal se dicta por teléfono o se escribe en un papel.
const WORDS = [
  "Ceiba",
  "Coral",
  "Mango",
  "Palma",
  "Garza",
  "Tucan",
  "Lapa",
  "Roble",
  "Brisa",
  "Delfin",
  "Iguana",
  "Jaguar",
  "Caracol",
  "Marea",
  "Pino",
  "Guara",
  "Arena",
  "Velero",
  "Faro",
  "Ola",
];

/** "Ceiba-4821-Coral": fácil de dictar y de escribir, y de un solo uso (se cambia al entrar). */
function temporaryPassword(): string {
  const word = () => WORDS[randomInt(WORDS.length)] as string;
  return `${word()}-${randomInt(1000, 10000)}-${word()}`;
}

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
      const [byNationalId] = input.nationalId
        ? await tx.select().from(users).where(eq(users.nationalId, input.nationalId))
        : [];
      const [byEmail] = input.email ? await tx.select().from(users).where(eq(users.email, input.email)) : [];
      if (byNationalId && byEmail && byNationalId.id !== byEmail.id) {
        throw conflict("Esa identidad y ese correo pertenecen a cuentas distintas");
      }
      let user = byNationalId ?? byEmail;
      const linkedExisting = Boolean(user);
      let password: string | null = null;

      if (!user) {
        password = temporaryPassword();
        [user] = await tx
          .insert(users)
          .values({
            name: input.name,
            email: input.email ?? null,
            nationalId: input.nationalId ?? null,
            passwordHash: await hashPassword(password),
            mustChangePassword: true,
          })
          .returning();
      } else if ((input.nationalId && !user.nationalId) || (input.email && !user.email)) {
        // Se completa el dato que le faltaba (p. ej. tenía correo y ahora también entra con su identidad).
        [user] = await tx
          .update(users)
          .set({
            nationalId: user.nationalId ?? input.nationalId ?? null,
            email: user.email ?? input.email ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning();
      }
      if (!user) throw new Error("No se pudo crear la cuenta");

      const existing = await familyMembership(tx, user.id, schoolId);
      if (!existing) {
        const [membership] = await tx
          .insert(memberships)
          .values({ userId: user.id, role: "padre", schoolId })
          .returning();
        if (membership && !user.lastMembershipId) {
          await tx.update(users).set({ lastMembershipId: membership.id }).where(eq(users.id, user.id));
        }
      } else if (!existing.active) {
        await tx
          .update(memberships)
          .set({ active: true, updatedAt: new Date() })
          .where(eq(memberships.id, existing.id));
      }
      await audit(tx, request, {
        action: "family_account.granted",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: user.id,
        data: { linkedExisting },
      });
      return {
        userId: user.id,
        login: loginOf(user, input.nationalId ? "nationalId" : "email"),
        temporaryPassword: password,
        linkedExisting,
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
