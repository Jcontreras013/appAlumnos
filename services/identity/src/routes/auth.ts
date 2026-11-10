import { forbidden, notFound, parseOrThrow, unauthorized } from "@escolar/service-kit";
import {
  changePasswordInputSchema,
  type LoginResponseDto,
  loginIdentifier,
  loginInputSchema,
  type MeResponseDto,
  refreshInputSchema,
  switchMembershipInputSchema,
  type TokenPairDto,
} from "@escolar/shared";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Tx } from "../db/client";
import { schools, type User, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { type ResolvedMembership, usableMemberships } from "../lib/access";
import { audit } from "../lib/audit";
import { publicJwks } from "../lib/keys";
import { hashPassword, verifyPassword } from "../lib/passwords";
import type { TokenService } from "../lib/tokens";
import { toSchoolDto, toUserDto } from "../lib/users";

/** Intentos fallidos seguidos antes de bloquear la cuenta, y por cuánto tiempo. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

const INVALID_CREDENTIALS = `Usuario o contraseña incorrectos. Después de ${MAX_FAILED_LOGINS} intentos fallidos la cuenta se bloquea ${LOCK_MINUTES} minutos.`;

/** Abre una sesión con un acceso concreto y lo recuerda para el próximo inicio de sesión. */
async function openSession(
  tx: Tx,
  tokens: TokenService,
  request: FastifyRequest,
  user: User,
  chosen: ResolvedMembership,
  action: string,
): Promise<LoginResponseDto> {
  const { refreshTokenId: _, ...pair } = await tokens.issuePair(tx, { user, membership: chosen.membership });
  await tx.update(users).set({ lastMembershipId: chosen.membership.id }).where(eq(users.id, user.id));
  await audit(tx, request, {
    action,
    schoolId: chosen.membership.schoolId,
    actorUserId: user.id,
    entityType: "membership",
    entityId: chosen.membership.id,
  });
  return { ...pair, user: toUserDto(user, chosen.membership) };
}

export async function authRoutes(app: FastifyInstance, { db, keys, tokens, settings }: IdentityDeps) {
  const jwks = await publicJwks(keys);
  app.get("/.well-known/jwks.json", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return jwks;
  });

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: settings.loginRateLimitPerMinute, timeWindow: "1 minute" } } },
    async (request): Promise<LoginResponseDto> => {
      const input = parseOrThrow(loginInputSchema, request.body);
      const id = loginIdentifier(input.email);
      const [user] = await db
        .select()
        .from(users)
        .where("nationalId" in id ? eq(users.nationalId, id.nationalId) : eq(users.email, id.email))
        .limit(1);
      // Cuenta bloqueada por intentos fallidos: ni se mira la contraseña (pero se tarda lo mismo).
      const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date());
      const passwordOk = locked
        ? await verifyPassword(null, input.password)
        : await verifyPassword(user?.passwordHash ?? null, input.password);

      // El mismo mensaje para "no existe", "contraseña incorrecta", "bloqueada" y "desactivado":
      // la pantalla de login no debe servir para averiguar qué correos o identidades están registrados.
      if (!user || !passwordOk || !user.active) {
        if (user) {
          if (!locked && !passwordOk) {
            // En SQL para que dos intentos al mismo tiempo no se salten el límite.
            const [after] = await db
              .update(users)
              .set({
                failedLogins: sql`case when ${users.failedLogins} + 1 >= ${MAX_FAILED_LOGINS} then 0 else ${users.failedLogins} + 1 end`,
                lockedUntil: sql`case when ${users.failedLogins} + 1 >= ${MAX_FAILED_LOGINS} then now() + make_interval(mins => ${LOCK_MINUTES}) else null end`,
              })
              .where(eq(users.id, user.id))
              .returning({ lockedUntil: users.lockedUntil });
            if (after?.lockedUntil) {
              await audit(db, request, {
                action: "auth.locked",
                actorUserId: user.id,
                entityType: "user",
                entityId: user.id,
              });
            }
          }
          await audit(db, request, {
            action: "auth.login_failed",
            actorUserId: user.id,
            entityType: "user",
            entityId: user.id,
            data: { reason: locked ? "locked" : passwordOk ? "inactive" : "bad_password" },
          });
        } else {
          request.log.warn({ login: input.email }, "Intento de login con un usuario no registrado");
        }
        throw unauthorized(INVALID_CREDENTIALS);
      }

      if (user.failedLogins > 0 || user.lockedUntil) {
        await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
      }
      const options = await usableMemberships(db, user.id);
      if (options.length === 0) {
        throw forbidden("Tu cuenta no tiene acceso activo a ningún centro. Comunícate con la dirección.");
      }
      // Se entra directo al último centro usado; desde el panel se puede cambiar.
      const chosen = options.find((o) => o.membership.id === user.lastMembershipId) ?? options[0];
      if (!chosen) throw forbidden();
      return db.transaction((tx) => openSession(tx, tokens, request, user, chosen, "auth.login"));
    },
  );

  /** Cambiar la contraseña propia (obligatorio la primera vez si el centro entregó una temporal). */
  app.post(
    "/auth/password",
    { preHandler: app.authenticate, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parseOrThrow(changePasswordInputSchema, request.body);
      const [user] = await db.select().from(users).where(eq(users.id, request.auth.userId));
      if (!user?.active) throw unauthorized();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw forbidden("La contraseña actual no es correcta");
      }
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: await hashPassword(input.newPassword),
            mustChangePassword: false,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        await audit(tx, request, {
          action: "auth.password_changed",
          actorUserId: user.id,
          entityType: "user",
          entityId: user.id,
        });
      });
      return reply.status(204).send();
    },
  );

  /** Cambiar de centro (o de rol) sin volver a escribir la contraseña. */
  app.post("/auth/switch", { preHandler: app.authenticate }, async (request): Promise<LoginResponseDto> => {
    const input = parseOrThrow(switchMembershipInputSchema, request.body);
    const [user] = await db.select().from(users).where(eq(users.id, request.auth.userId));
    if (!user?.active) throw unauthorized();
    const target = (await usableMemberships(db, user.id)).find((o) => o.membership.id === input.membershipId);
    if (!target) throw notFound("No tienes ese acceso o está desactivado");
    if (input.refreshToken) await tokens.revokeFamilyOf(input.refreshToken);
    return db.transaction((tx) => openSession(tx, tokens, request, user, target, "auth.switch"));
  });

  app.post(
    "/auth/refresh",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request): Promise<TokenPairDto> => {
      const { refreshToken } = parseOrThrow(refreshInputSchema, request.body);
      const result = await tokens.rotate(refreshToken);

      if (result.kind === "reuse_detected") {
        request.log.warn({ userId: result.userId }, "Reuso de refresh token: sesión revocada");
        await audit(db, request, {
          action: "auth.refresh_reuse_detected",
          schoolId: result.schoolId,
          actorUserId: result.userId,
          entityType: "session",
          entityId: result.familyId,
        });
        throw unauthorized();
      }
      if (result.kind === "invalid") throw unauthorized();
      return result.pair;
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const parsed = refreshInputSchema.safeParse(request.body);
    if (parsed.success) {
      const revoked = await tokens.revokeFamilyOf(parsed.data.refreshToken);
      if (revoked) {
        await audit(db, request, { action: "auth.logout", actorUserId: revoked.userId });
      }
    }
    // Siempre 204: cerrar sesión es idempotente y no revela si el token existía.
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: app.authenticate }, async (request): Promise<MeResponseDto> => {
    const [user] = await db.select().from(users).where(eq(users.id, request.auth.userId));
    if (!user?.active) throw unauthorized();
    const options = await usableMemberships(db, user.id);
    // El acceso de esta sesión es el que coincide con el token (rol + ámbito).
    const { role, schoolId, districtId, departmentId } = request.auth;
    const current = options.find(
      (o) =>
        o.membership.role === role &&
        o.membership.schoolId === schoolId &&
        o.membership.districtId === districtId &&
        o.membership.departmentId === departmentId,
    );
    if (!current) throw unauthorized("Ese acceso ya no está activo");
    const [school] = schoolId ? await db.select().from(schools).where(eq(schools.id, schoolId)) : [];
    return {
      user: toUserDto(user, current.membership),
      school: school ? toSchoolDto(school) : null,
      current: current.dto,
      memberships: options.map((o) => o.dto),
    };
  });
}
