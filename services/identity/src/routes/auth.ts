import { forbidden, parseOrThrow, unauthorized } from "@escolar/service-kit";
import {
  type LoginResponseDto,
  loginInputSchema,
  type MeResponseDto,
  refreshInputSchema,
  type TokenPairDto,
} from "@escolar/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { schools, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { publicJwks } from "../lib/keys";
import { verifyPassword } from "../lib/passwords";
import { toSchoolDto, toUserDto } from "../lib/users";

const INVALID_CREDENTIALS = "Correo o contraseña incorrectos";

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
      const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      const passwordOk = await verifyPassword(user?.passwordHash ?? null, input.password);

      // El mismo mensaje para "no existe", "contraseña incorrecta" y "desactivado":
      // la pantalla de login no debe servir para averiguar qué correos están registrados.
      if (!user || !passwordOk || !user.active) {
        if (user) {
          await audit(db, request, {
            action: "auth.login_failed",
            schoolId: user.schoolId,
            actorUserId: user.id,
            entityType: "user",
            entityId: user.id,
            data: { reason: passwordOk ? "inactive" : "bad_password" },
          });
        } else {
          request.log.warn({ email: input.email }, "Intento de login con correo no registrado");
        }
        throw unauthorized(INVALID_CREDENTIALS);
      }

      let school = null;
      if (user.schoolId) {
        [school] = await db.select().from(schools).where(eq(schools.id, user.schoolId));
        if (!school?.active) {
          throw forbidden("El colegio está desactivado. Comunícate con soporte.");
        }
      }

      const { refreshTokenId: _, ...pair } = await db.transaction(async (tx) => {
        const issued = await tokens.issuePair(tx, user);
        await audit(tx, request, {
          action: "auth.login",
          schoolId: user.schoolId,
          actorUserId: user.id,
          entityType: "user",
          entityId: user.id,
        });
        return issued;
      });
      return { ...pair, user: toUserDto(user) };
    },
  );

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
    const [school] = user.schoolId
      ? await db.select().from(schools).where(eq(schools.id, user.schoolId))
      : [];
    return { user: toUserDto(user), school: school ? toSchoolDto(school) : null };
  });
}
