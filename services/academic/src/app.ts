import {
  type AccessTokenVerifier,
  authPlugin,
  createAccessTokenVerifier,
  createService,
} from "@escolar/service-kit";
import { todayInHonduras } from "@escolar/shared";
import type { FastifyServerOptions } from "fastify";
import { type Db, ping } from "./db/client";
import type { AcademicDeps } from "./deps";
import type { IdentityClient } from "./lib/identity-client";
import { importRoutes } from "./routes/import";
import { regionalRoutes } from "./routes/regional";
import { staffRoutes } from "./routes/staff";
import { structureRoutes } from "./routes/structure";
import { studentRoutes } from "./routes/students";

export interface BuildAppOptions {
  db: Db;
  identity: IdentityClient;
  /** En producción: JWKS de identity. En tests: la llave pública generada en el test. */
  verifier?: AccessTokenVerifier;
  identityUrl?: string;
  today?: () => string;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(options: BuildAppOptions) {
  const app = await createService({
    name: "academic",
    logger: options.logger,
    readiness: () => ping(options.db),
  });

  const verifier =
    options.verifier ??
    (await createAccessTokenVerifier({ jwksUrl: `${options.identityUrl}/.well-known/jwks.json` }));
  await app.register(authPlugin, { verifier });

  const deps: AcademicDeps = {
    db: options.db,
    identity: options.identity,
    today: options.today ?? (() => todayInHonduras()),
  };
  await app.register(async (scope) => {
    await structureRoutes(scope, deps);
    await studentRoutes(scope, deps);
    await importRoutes(scope, deps);
    await staffRoutes(scope, deps);
    await regionalRoutes(scope, deps);
  });
  return app;
}
