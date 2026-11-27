import {
  type AccessTokenVerifier,
  authPlugin,
  createAccessTokenVerifier,
  createService,
  defaultFilesDir,
  type FileStore,
  localFileStore,
} from "@escolar/service-kit";
import { todayInHonduras } from "@escolar/shared";
import type { FastifyServerOptions } from "fastify";
import { type Db, ping } from "./db/client";
import type { AcademicDeps } from "./deps";
import type { IdentityClient } from "./lib/identity-client";
import type { PlanDrafter } from "./lib/plan-assistant";
import { announcementRoutes } from "./routes/announcements";
import { auditLogRoutes } from "./routes/audit-log";
import { calendarRoutes } from "./routes/calendar";
import { changeRequestRoutes } from "./routes/change-requests";
import { classChatRoutes } from "./routes/class-chat";
import { classroomRoutes } from "./routes/classroom";
import { conductRoutes } from "./routes/conduct";
import { documentRoutes } from "./routes/documents";
import { evaluationRoutes } from "./routes/evaluation";
import { exportRoutes } from "./routes/exports";
import { familyRoutes } from "./routes/family";
import { finalRoutes } from "./routes/finals";
import { followUpRoutes } from "./routes/followups";
import { importRoutes } from "./routes/import";
import { libraryRoutes } from "./routes/library";
import { paymentRoutes } from "./routes/payments";
import { planRoutes } from "./routes/plans";
import { quizRoutes } from "./routes/quizzes";
import { regionalRoutes } from "./routes/regional";
import { scheduleRoutes } from "./routes/schedule";
import { shiftRoutes } from "./routes/shifts";
import { staffRoutes } from "./routes/staff";
import { structureRoutes } from "./routes/structure";
import { studentAccessRoutes } from "./routes/student-access";
import { studentRoutes } from "./routes/students";
import { taskRoutes } from "./routes/tasks";
import { transferRoutes } from "./routes/transfers";

export interface BuildAppOptions {
  db: Db;
  identity: IdentityClient;
  /** En producción: JWKS de identity. En tests: la llave pública generada en el test. */
  verifier?: AccessTokenVerifier;
  identityUrl?: string;
  today?: () => string;
  logger?: FastifyServerOptions["logger"];
  /** Asistente de planificación (en producción, Claude). Sin él, el asistente aparece como no disponible. */
  planDrafter?: PlanDrafter | null;
  /** Archivos de la biblioteca; por defecto, la carpeta .biblioteca (desarrollo). */
  files?: FileStore;
  /** Llave para cifrar las llaves secretas de la pasarela (PAYMENTS_ENCRYPTION_KEY). */
  paymentsKey?: string | null;
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
    planDrafter: options.planDrafter ?? null,
    files: options.files ?? localFileStore(defaultFilesDir(".biblioteca")),
    paymentsKey: options.paymentsKey ?? null,
  };
  await app.register(async (scope) => {
    await structureRoutes(scope, deps);
    await studentRoutes(scope, deps);
    await importRoutes(scope, deps);
    await staffRoutes(scope, deps);
    await regionalRoutes(scope, deps);
    await evaluationRoutes(scope, deps);
    await planRoutes(scope, deps);
    await familyRoutes(scope, deps);
    await studentAccessRoutes(scope, deps);
    await classroomRoutes(scope, deps);
    await taskRoutes(scope, deps);
    await quizRoutes(scope, deps);
    await classChatRoutes(scope, deps);
    await changeRequestRoutes(scope, deps);
    await paymentRoutes(scope, deps);
    await shiftRoutes(scope, deps);
    await exportRoutes(scope, deps);
    await followUpRoutes(scope, deps);
    await announcementRoutes(scope, deps);
    await auditLogRoutes(scope, deps);
    await calendarRoutes(scope, deps);
    await documentRoutes(scope, deps);
    await libraryRoutes(scope, deps);
    await scheduleRoutes(scope, deps);
    await transferRoutes(scope, deps);
    await finalRoutes(scope, deps);
    await conductRoutes(scope, deps);
  });
  return app;
}
