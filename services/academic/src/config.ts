import { databaseUrlFromEnv, intEnv, optionalEnv } from "@escolar/service-kit";

/** Proveedor del asistente de planificación con IA y lo que necesita para conectarse. */
export type PlanAssistantConfig =
  | { provider: "claude" }
  | { provider: "gemini" | "groq"; apiKey: string; model?: string };

/** Llave de cada proveedor y, si aplica, la variable que fija el modelo. */
const PROVIDERS = {
  claude: { key: "ANTHROPIC_API_KEY", model: null },
  gemini: { key: "GEMINI_API_KEY", model: "GEMINI_MODEL" },
  groq: { key: "GROQ_API_KEY", model: "GROQ_MODEL" },
} as const;
type Provider = keyof typeof PROVIDERS;

export interface AcademicConfig {
  port: number;
  databaseUrl: string;
  runMigrationsOnStart: boolean;
  /** Servicio de identidad: de ahí salen las llaves públicas (JWKS) y la validación de docentes. */
  identityUrl: string;
  /** Asistente de planificación con IA; null si la instalación no lo tiene. */
  planAssistant: PlanAssistantConfig | null;
  /** Proveedores de respaldo (con llave) por si el principal falla. */
  planAssistantBackups: PlanAssistantConfig[];
  /** Por qué el asistente quedó apagado aunque se pidió (para avisarlo en los registros). */
  planAssistantWarning: string | null;
}

/**
 * Asistente de planificación:
 * - PLAN_ASSISTANT=off lo apaga aunque haya llave.
 * - PLAN_ASSISTANT_PROVIDER elige "claude", "gemini" o "groq". Si no se indica, se usa el primero
 *   que tenga llave en ese orden (ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY).
 * - GEMINI_MODEL y GROQ_MODEL fijan el modelo de esos proveedores (si no, el de cada módulo).
 */
export function planAssistantFromEnv(env: NodeJS.ProcessEnv): {
  config: PlanAssistantConfig | null;
  warning: string | null;
} {
  const value = (name: string) => env[name]?.trim() || undefined;
  if (value("PLAN_ASSISTANT") === "off") return { config: null, warning: null };
  const requested = value("PLAN_ASSISTANT_PROVIDER")?.toLowerCase();
  if (requested && !Object.hasOwn(PROVIDERS, requested)) {
    throw new Error(
      `PLAN_ASSISTANT_PROVIDER no reconocido: "${requested}". Usa "claude", "gemini" o "groq".`,
    );
  }
  const provider =
    (requested as Provider | undefined) ??
    (Object.keys(PROVIDERS) as Provider[]).find((p) => value(PROVIDERS[p].key));
  if (!provider) return { config: null, warning: null };
  const { key, model } = PROVIDERS[provider];
  const apiKey = value(key);
  if (!apiKey) {
    return {
      config: null,
      warning: `PLAN_ASSISTANT_PROVIDER=${provider} pero falta ${key}: el asistente queda apagado.`,
    };
  }
  if (provider === "claude") return { config: { provider }, warning: null };
  return { config: { provider, apiKey, model: model ? value(model) : undefined }, warning: null };
}

/**
 * Respaldo del asistente: los demás proveedores que tienen llave, en el mismo orden. Si el principal
 * falla (ocupado, sin cupo, llave vencida), se usa el siguiente. PLAN_ASSISTANT_FALLBACK=off lo evita.
 */
export function planAssistantBackupsFromEnv(
  env: NodeJS.ProcessEnv,
  primary: PlanAssistantConfig | null,
): PlanAssistantConfig[] {
  const value = (name: string) => env[name]?.trim() || undefined;
  if (!primary || value("PLAN_ASSISTANT_FALLBACK") === "off") return [];
  return (Object.keys(PROVIDERS) as Provider[])
    .filter((p) => p !== primary.provider && value(PROVIDERS[p].key))
    .map((p): PlanAssistantConfig => {
      if (p === "claude") return { provider: p };
      const model = PROVIDERS[p].model;
      return {
        provider: p,
        apiKey: value(PROVIDERS[p].key) as string,
        model: model ? value(model) : undefined,
      };
    });
}

export function loadConfig(): AcademicConfig {
  const assistant = planAssistantFromEnv(process.env);
  return {
    port: intEnv("PORT", 3002),
    databaseUrl: databaseUrlFromEnv(),
    runMigrationsOnStart: optionalEnv("RUN_MIGRATIONS", "true") === "true",
    identityUrl: optionalEnv("IDENTITY_URL", "http://localhost:3001"),
    planAssistant: assistant.config,
    planAssistantBackups: planAssistantBackupsFromEnv(process.env, assistant.config),
    planAssistantWarning: assistant.warning,
  };
}
