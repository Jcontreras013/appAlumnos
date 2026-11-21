import {
  DRAFT_MESSAGES,
  draftPrompt,
  PlanDraftError,
  type PlanDrafter,
  planJsonSchema,
  readDraftJson,
  systemPromptFor,
} from "./plan-assistant";

/*
 * Asistente de planificación con Gemini (Google), por su API REST: la misma indicación y la misma
 * plantilla que con Claude. La capa gratuita de Gemini sirve para el piloto; en ella Google puede
 * usar lo que se le envía para mejorar sus productos (por eso al modelo nunca van datos de alumnos).
 */

/**
 * Por defecto, el Flash más reciente (alias que Google actualiza y avisa con dos semanas). En
 * producción conviene fijar una versión con GEMINI_MODEL, la que muestra AI Studio.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const API_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Por qué Gemini corta una respuesta sin terminarla por contenido (no por largo). */
const REFUSED_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "LANGUAGE",
]);

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

interface GeminiError {
  error?: { code?: number; message?: string; status?: string; details?: Array<{ reason?: string }> };
}

export function geminiPlanDrafter(options: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): PlanDrafter {
  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async draft(request) {
      // Sin temperatura ni otros ajustes de muestreo: los modelos nuevos de Gemini los rechazan.
      const body = {
        systemInstruction: { parts: [{ text: systemPromptFor(request.language) }] },
        contents: [{ role: "user", parts: [{ text: draftPrompt(request) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: planJsonSchema(request.fields),
        },
      };
      let response: Response;
      try {
        response = await fetchImpl(`${API_URL}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          // La llave va en un encabezado, no en la dirección: así no queda en registros de acceso.
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        });
      } catch (err) {
        throw new PlanDraftError("unavailable", DRAFT_MESSAGES.busy, { cause: err });
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as GeminiError | null;
        const cause = new Error(
          `Gemini respondió ${response.status} ${data?.error?.status ?? ""}: ${data?.error?.message ?? "sin detalle"}`,
        );
        if (response.status === 429) throw new PlanDraftError("unavailable", DRAFT_MESSAGES.limit, { cause });
        if (response.status >= 500) throw new PlanDraftError("unavailable", DRAFT_MESSAGES.busy, { cause });
        // Llave inválida, modelo que no existe o una petición que Google no acepta: lo arregla quien
        // administra la plataforma; el motivo exacto queda en los registros del servicio.
        throw new PlanDraftError("unavailable", DRAFT_MESSAGES.misconfigured, { cause });
      }

      const data = (await response.json().catch(() => null)) as GeminiResponse | null;
      if (data?.promptFeedback?.blockReason) {
        throw new PlanDraftError("refused", DRAFT_MESSAGES.refused, {
          cause: new Error(`Gemini bloqueó la indicación: ${data.promptFeedback.blockReason}`),
        });
      }
      const candidate = data?.candidates?.[0];
      const finish = candidate?.finishReason;
      if (finish && REFUSED_REASONS.has(finish)) {
        throw new PlanDraftError("refused", DRAFT_MESSAGES.refused, {
          cause: new Error(`Gemini cortó la respuesta: ${finish}`),
        });
      }
      if (!candidate || finish === "MAX_TOKENS") {
        throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, {
          cause: new Error(`Gemini no terminó la respuesta: ${finish ?? "sin candidatos"}`),
        });
      }
      const text = (candidate.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      return readDraftJson(text, request, "Gemini");
    },
  };
}
