import { authPlugin, createAccessTokenVerifier, createService } from "@escolar/service-kit";
import rateLimit from "@fastify/rate-limit";
import type { FastifyServerOptions } from "fastify";
import type { TokenSettings } from "./config";
import { type Db, ping } from "./db/client";
import type { IdentityDeps } from "./deps";
import type { SigningKeys } from "./lib/keys";
import type { PushSender } from "./lib/push";
import { TokenService } from "./lib/tokens";
import { accountRoutes } from "./routes/accounts";
import { activityRoutes } from "./routes/activity";
import { auditLogRoutes } from "./routes/audit-log";
import { authRoutes } from "./routes/auth";
import { familyRoutes } from "./routes/family";
import { logoRoutes } from "./routes/logo";
import { messageRoutes } from "./routes/messages";
import { onboardingRoutes } from "./routes/onboarding";
import { regionRoutes, transferTargetRoutes } from "./routes/regions";
import { schoolRoutes } from "./routes/schools";
import { userRoutes } from "./routes/users";

export interface BuildAppOptions {
  db: Db;
  keys: SigningKeys;
  settings: TokenSettings & {
    loginRateLimitPerMinute: number;
    /** Exigir verificación en dos pasos a los cargos regionales y de la plataforma (por defecto, sí). */
    requireMfa?: boolean;
  };
  logger?: FastifyServerOptions["logger"];
  /** Avisos al celular de los mensajes (sin llaves VAPID no hay avisos, pero los mensajes funcionan). */
  push?: PushSender | null;
  now?: () => Date;
}

export async function buildApp({ db, keys, settings, logger, push = null, now }: BuildAppOptions) {
  const app = await createService({ name: "identity", logger, readiness: () => ping(db) });

  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, {
    verifier: await createAccessTokenVerifier({ publicKey: keys.publicKey }),
  });

  const deps: IdentityDeps = {
    db,
    keys,
    settings,
    tokens: new TokenService(db, keys, settings),
    push,
    now: now ?? (() => new Date()),
  };
  await app.register(async (scope) => {
    await authRoutes(scope, deps);
    await schoolRoutes(scope, deps);
    await userRoutes(scope, deps);
    await logoRoutes(scope, deps);
    await regionRoutes(scope, deps);
    await transferTargetRoutes(scope, deps);
    await familyRoutes(scope, deps);
    await onboardingRoutes(scope, deps);
    await accountRoutes(scope, deps);
    await activityRoutes(scope, deps);
    await auditLogRoutes(scope, deps);
    await messageRoutes(scope, deps);
  });

  return app;
}
