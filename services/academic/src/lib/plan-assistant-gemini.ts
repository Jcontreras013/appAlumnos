import { type PlanField, parsePlanContent, WEEKDAYS } from "@escolar/shared";
import {
  DRAFT_MESSAGES,
  draftPrompt,
  onlyClassDays,
  PlanDraftError,
  type PlanDrafter,
  SYSTEM_PROMPT,
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

/** El formato de la respuesta (JSON Schema) sale de la plantilla del centro. */
export function geminiSchemaFor(fields: PlanField[]) {
  const properties: Record<string, unknown> = {};
  for (const field of fields) {
    const description = [field.label, field.help].filter(Boolean).join(". ");
    properties[field.key] =
      field.type === "dias"
        ? {
            type: "object",
            description,
            properties: Object.fromEntries(WEEKDAYS.map((d) => [d, { type: "string" }])),
            required: [...WEEKDAYS],
          }
        : { type: "string", description };
  }
  return { type: "object", properties, required: fields.map((f) => f.key) };
}

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

/** Quita un cerco ```json … ``` si el modelo lo agregara (con respuesta JSON no debería). */
const unfence = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

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
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: draftPrompt(request) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: geminiSchemaFor(request.fields),
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(unfence(text));
      } catch (err) {
        throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, { cause: err });
      }
      const { content, errors } = parsePlanContent(request.fields, parsed);
      // Un campo puede quedar vacío (p. ej. sin tarea esa semana), pero no la plantilla entera.
      const filled = Object.values(content).some((v) =>
        typeof v === "string" ? v !== "" : Object.values(v ?? {}).some((day) => day !== ""),
      );
      if (Object.keys(errors).length > 0 || !filled) {
        throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, {
          cause: new Error(`Gemini devolvió la plantilla incompleta: ${JSON.stringify(errors)}`),
        });
      }
      return onlyClassDays(request.fields, content, request.classDays);
    },
  };
}
