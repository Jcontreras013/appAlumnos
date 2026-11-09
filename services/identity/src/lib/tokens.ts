import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER, JWT_ALGORITHM } from "@escolar/service-kit";
import type { TokenPairDto } from "@escolar/shared";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT } from "jose";
import type { TokenSettings } from "../config";
import type { Db, DbOrTx } from "../db/client";
import { type Membership, memberships, refreshTokens, type User, users } from "../db/schema";
import { resolveMemberships } from "./access";
import type { SigningKeys } from "./keys";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Una sesión siempre trabaja con una persona y uno de sus accesos (rol + centro/distrito/departamento). */
export interface SessionSubject {
  user: Pick<User, "id" | "name">;
  membership: Pick<Membership, "id" | "role" | "schoolId" | "districtId" | "departmentId">;
}

export type RotateResult =
  | { kind: "ok"; pair: TokenPairDto; user: User }
  | { kind: "invalid" }
  | { kind: "reuse_detected"; userId: string; schoolId: string | null; familyId: string };

export class TokenService {
  constructor(
    private readonly db: Db,
    private readonly keys: SigningKeys,
    private readonly settings: TokenSettings,
  ) {}

  async signAccessToken({ user, membership }: SessionSubject): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      name: user.name,
      role: membership.role,
      school_id: membership.schoolId,
      district_id: membership.districtId,
      department_id: membership.departmentId,
      mid: membership.id,
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM, kid: this.keys.keyId })
      .setSubject(user.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + this.settings.accessTokenTtlSeconds)
      .setJti(randomUUID())
      .sign(this.keys.privateKey);
  }

  /** Emite un access token y un refresh token nuevo. Sin `familyId` empieza una sesión nueva. */
  async issuePair(
    db: DbOrTx,
    subject: SessionSubject,
    familyId: string = randomUUID(),
  ): Promise<TokenPairDto & { refreshTokenId: string }> {
    const refreshToken = randomBytes(32).toString("base64url");
    const [row] = await db
      .insert(refreshTokens)
      .values({
        userId: subject.user.id,
        membershipId: subject.membership.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.settings.refreshTokenTtlSeconds * 1000),
      })
      .returning({ id: refreshTokens.id });
    if (!row) throw new Error("No se pudo crear el refresh token");

    return {
      accessToken: await this.signAccessToken(subject),
      refreshToken,
      expiresIn: this.settings.accessTokenTtlSeconds,
      refreshExpiresIn: this.settings.refreshTokenTtlSeconds,
      refreshTokenId: row.id,
    };
  }

  /**
   * Cambia un refresh token por un par nuevo (rotación). La fila se bloquea con FOR UPDATE para
   * que dos peticiones simultáneas con el mismo token no puedan rotarlo dos veces sin detectarse.
   *
   * Importante: la revocación por reuso se devuelve como resultado (no como excepción) para que
   * la transacción haga COMMIT; si se lanzara un error aquí, el rollback desharía la revocación.
   */
  async rotate(token: string): Promise<RotateResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(token)))
        .for("update");
      if (!row) return { kind: "invalid" };

      const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
      if (!user) return { kind: "invalid" };

      if (row.revokedAt) {
        // Revocado sin reemplazo = sesión cerrada (logout, usuario desactivado). Simplemente no vale.
        if (row.replacedById === null) return { kind: "invalid" };

        const withinGrace =
          Date.now() - row.revokedAt.getTime() <= this.settings.refreshReuseGraceSeconds * 1000;
        if (!withinGrace) {
          await tx
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
          const [m] = await tx.select().from(memberships).where(eq(memberships.id, row.membershipId));
          return {
            kind: "reuse_detected",
            userId: user.id,
            schoolId: m?.schoolId ?? null,
            familyId: row.familyId,
          };
        }
        // Dentro de la ventana de gracia solo se acepta si la sesión sigue viva.
        const [alive] = await tx
          .select({ id: refreshTokens.id })
          .from(refreshTokens)
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)))
          .limit(1);
        if (!alive) return { kind: "invalid" };
      } else if (row.expiresAt.getTime() <= Date.now()) {
        return { kind: "invalid" };
      }

      if (!user.active) return { kind: "invalid" };
      // El acceso de la sesión debe seguir activo (y su centro también).
      const [membership] = await tx.select().from(memberships).where(eq(memberships.id, row.membershipId));
      if (!membership) return { kind: "invalid" };
      const [resolved] = await resolveMemberships(tx, [membership]);
      if (!resolved?.usable) return { kind: "invalid" };

      const { refreshTokenId, ...pair } = await this.issuePair(tx, { user, membership }, row.familyId);
      if (!row.revokedAt) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), replacedById: refreshTokenId })
          .where(eq(refreshTokens.id, row.id));
      }
      return { kind: "ok", pair, user };
    });
  }

  /** Cierra la sesión: revoca todos los tokens de la familia del token indicado. */
  async revokeFamilyOf(token: string): Promise<{ userId: string } | null> {
    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(token)));
    if (!row) return null;
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    return { userId: row.userId };
  }

  /** Revoca las sesiones abiertas con un acceso concreto (al quitarle el acceso a un centro). */
  async revokeForMembership(db: DbOrTx, membershipId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.membershipId, membershipId), isNull(refreshTokens.revokedAt)));
  }

  /** Revoca todas las sesiones de un usuario (al desactivarlo o cambiar su contraseña). */
  async revokeAllForUser(db: DbOrTx, userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
