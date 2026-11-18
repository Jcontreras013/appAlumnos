import { databaseUrlFromEnv, intEnv, optionalEnv } from "@escolar/service-kit";

export interface AcademicConfig {
  port: number;
  databaseUrl: string;
  runMigrationsOnStart: boolean;
  /** Servicio de identidad: de ahí salen las llaves públicas (JWKS) y la validación de docentes. */
  identityUrl: string;
  /**
   * Asistente de planificación con IA (Claude). Se activa cuando hay ANTHROPIC_API_KEY; con
   * PLAN_ASSISTANT=off se apaga aunque haya llave.
   */
  planAssistant: boolean;
}

export function loadConfig(): AcademicConfig {
  return {
    port: intEnv("PORT", 3002),
    databaseUrl: databaseUrlFromEnv(),
    runMigrationsOnStart: optionalEnv("RUN_MIGRATIONS", "true") === "true",
    identityUrl: optionalEnv("IDENTITY_URL", "http://localhost:3001"),
    planAssistant: Boolean(process.env.ANTHROPIC_API_KEY) && optionalEnv("PLAN_ASSISTANT", "on") !== "off",
  };
}
