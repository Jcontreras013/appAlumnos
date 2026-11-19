import {
  DRAFT_MESSAGES,
  draftPrompt,
  PlanDraftError,
  type PlanDrafter,
  planJsonSchema,
  readDraftJson,
  SYSTEM_PROMPT,
} from "./plan-assistant";

/*
 * Asistente de planificación con Groq, por su API compatible con OpenAI: la misma indicación y la
 * misma plantilla que con Claude y Gemini. Groq tiene capa gratuita sin tarjeta, con límites por
 * minuto y por día que alcanzan para un piloto. Al modelo nunca van datos de alumnos.
 */

/**
 * Por defecto, GPT-OSS 120B: en Groq responde con el formato estricto (la respuesta siempre trae la
 * plantilla completa). GROQ_MODEL elige otro de los que muestra la consola de Groq.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Los modelos GPT-OSS razonan antes de responder y en Groq aceptan el formato estricto; a los demás
 * se les pide el formato sin ajustes de razonamiento (los rechazarían) y en modo de mejor esfuerzo.
 */
const isGptOss = (model: string) => model.startsWith("openai/gpt-oss");

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }>;
}

interface GroqError {
  error?: { message?: string; type?: string; code?: string };
}

export function groqPlanDrafter(options: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): PlanDrafter {
  const model = options.model?.trim() || DEFAULT_GROQ_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const reasoning = isGptOss(model);
  return {
    async draft(request) {
      const body = {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: draftPrompt(request) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "planificacion",
            strict: reasoning,
            schema: planJsonSchema(request.fields, { closed: true }),
          },
        },
        // Tope de la respuesta: la capa gratuita cuenta los tokens por minuto, así que no conviene
        // pedir de más. Alcanza para la plantilla completa con su razonamiento.
        max_completion_tokens: 6000,
        ...(reasoning ? { reasoning_effort: "medium", include_reasoning: false } : {}),
      };
      let response: Response;
      try {
        response = await fetchImpl(API_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        });
      } catch (err) {
        throw new PlanDraftError("unavailable", DRAFT_MESSAGES.busy, { cause: err });
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as GroqError | null;
        const code = data?.error?.code ?? data?.error?.type ?? "";
        const cause = new Error(
          `Groq respondió ${response.status} ${code}: ${data?.error?.message ?? "sin detalle"}`,
        );
        if (response.status === 429) throw new PlanDraftError("unavailable", DRAFT_MESSAGES.limit, { cause });
        // El modelo escribió algo que no cumple el formato: otro intento suele salir bien.
        if (code === "json_validate_failed") {
          throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, { cause });
        }
        // 498: Groq sin capacidad por el momento; 5xx: falla de su lado.
        if (response.status === 498 || response.status >= 500) {
          throw new PlanDraftError("unavailable", DRAFT_MESSAGES.busy, { cause });
        }
        // Llave inválida, modelo que no existe o una petición más grande que el límite por minuto:
        // lo arregla quien administra la plataforma; el motivo exacto queda en los registros.
        throw new PlanDraftError("unavailable", DRAFT_MESSAGES.misconfigured, { cause });
      }

      const data = (await response.json().catch(() => null)) as GroqResponse | null;
      const choice = data?.choices?.[0];
      const finish = choice?.finish_reason;
      if (choice?.message?.refusal || finish === "content_filter") {
        throw new PlanDraftError("refused", DRAFT_MESSAGES.refused, {
          cause: new Error(`Groq no respondió el borrador: ${choice?.message?.refusal ?? finish}`),
        });
      }
      if (!choice || finish === "length" || typeof choice.message?.content !== "string") {
        throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, {
          cause: new Error(`Groq no terminó la respuesta: ${finish ?? "sin respuesta"}`),
        });
      }
      return readDraftJson(choice.message.content, request, "Groq");
    },
  };
}
