import { authPlugin, createAccessTokenVerifier, createService } from "@escolar/service-kit";
import rateLimit from "@fastify/rate-limit";
import type { FastifyServerOptions } from "fastify";
import type { TokenSettings } from "./config";
import { type Db, ping } from "./db/client";
import type { IdentityDeps } from "./deps";
import type { SigningKeys } from "./lib/keys";
import { TokenService } from "./lib/tokens";
import { authRoutes } from "./routes/auth";
import { familyRoutes } from "./routes/family";
import { logoRoutes } from "./routes/logo";
import { onboardingRoutes } from "./routes/onboarding";
import { regionRoutes } from "./routes/regions";
import { schoolRoutes } from "./routes/schools";
import { userRoutes } from "./routes/users";

export interface BuildAppOptions {
  db: Db;
  keys: SigningKeys;
  settings: TokenSettings & { loginRateLimitPerMinute: number };
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ db, keys, settings, logger }: BuildAppOptions) {
  const app = await createService({ name: "identity", logger, readiness: () => ping(db) });

  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, {
    verifier: await createAccessTokenVerifier({ publicKey: keys.publicKey }),
  });

  const deps: IdentityDeps = { db, keys, settings, tokens: new TokenService(db, keys, settings) };
  await app.register(async (scope) => {
    await authRoutes(scope, deps);
    await schoolRoutes(scope, deps);
    await userRoutes(scope, deps);
    await logoRoutes(scope, deps);
    await regionRoutes(scope, deps);
    await familyRoutes(scope, deps);
    await onboardingRoutes(scope, deps);
  });

  return app;
}
