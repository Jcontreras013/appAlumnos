import { databaseUrlFromEnv, intEnv, optionalEnv } from "@escolar/service-kit";

/** Proveedor del asistente de planificación con IA y lo que necesita para conectarse. */
export type PlanAssistantConfig =
  | { provider: "claude" }
  | { provider: "gemini"; apiKey: string; model?: string };

export interface AcademicConfig {
  port: number;
  databaseUrl: string;
  runMigrationsOnStart: boolean;
  /** Servicio de identidad: de ahí salen las llaves públicas (JWKS) y la validación de docentes. */
  identityUrl: string;
  /** Asistente de planificación con IA; null si la instalación no lo tiene. */
  planAssistant: PlanAssistantConfig | null;
  /** Por qué el asistente quedó apagado aunque se pidió (para avisarlo en los registros). */
  planAssistantWarning: string | null;
}

/**
 * Asistente de planificación:
 * - PLAN_ASSISTANT=off lo apaga aunque haya llave.
 * - PLAN_ASSISTANT_PROVIDER elige "gemini" o "claude". Si no se indica, se usa el que tenga llave
 *   (ANTHROPIC_API_KEY o GEMINI_API_KEY); con las dos, Claude.
 * - GEMINI_MODEL fija la versión de Gemini (por defecto, el Flash más reciente).
 */
export function planAssistantFromEnv(env: NodeJS.ProcessEnv): {
  config: PlanAssistantConfig | null;
  warning: string | null;
} {
  const value = (name: string) => env[name]?.trim() || undefined;
  if (value("PLAN_ASSISTANT") === "off") return { config: null, warning: null };
  const requested = value("PLAN_ASSISTANT_PROVIDER")?.toLowerCase();
  const anthropicKey = value("ANTHROPIC_API_KEY");
  const geminiKey = value("GEMINI_API_KEY");
  const provider = requested ?? (anthropicKey ? "claude" : geminiKey ? "gemini" : undefined);
  if (!provider) return { config: null, warning: null };
  if (provider === "gemini") {
    return geminiKey
      ? { config: { provider, apiKey: geminiKey, model: value("GEMINI_MODEL") }, warning: null }
      : {
          config: null,
          warning: "PLAN_ASSISTANT_PROVIDER=gemini pero falta GEMINI_API_KEY: el asistente queda apagado.",
        };
  }
  if (provider === "claude") {
    return anthropicKey
      ? { config: { provider }, warning: null }
      : {
          config: null,
          warning: "PLAN_ASSISTANT_PROVIDER=claude pero falta ANTHROPIC_API_KEY: el asistente queda apagado.",
        };
  }
  throw new Error(`PLAN_ASSISTANT_PROVIDER no reconocido: "${requested}". Usa "gemini" o "claude".`);
}

export function loadConfig(): AcademicConfig {
  const assistant = planAssistantFromEnv(process.env);
  return {
    port: intEnv("PORT", 3002),
    databaseUrl: databaseUrlFromEnv(),
    runMigrationsOnStart: optionalEnv("RUN_MIGRATIONS", "true") === "true",
    identityUrl: optionalEnv("IDENTITY_URL", "http://localhost:3001"),
    planAssistant: assistant.config,
    planAssistantWarning: assistant.warning,
  };
}
