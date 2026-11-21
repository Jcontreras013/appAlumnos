import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  type DaysValue,
  formatWeekRange,
  type PlanContent,
  type PlanField,
  parsePlanContent,
  type SubjectLanguage,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Weekday,
} from "@escolar/shared";
import { z } from "zod";

/**
 * Asistente de planificación: arma un borrador de la planificación semanal con los campos de la
 * plantilla del centro. Al modelo solo van la asignatura, el grado, el tema y lo que escribe el
 * docente; nunca datos de alumnos. El borrador no se guarda: el docente lo revisa y lo guarda.
 *
 * Hay tres proveedores con la misma indicación y la misma plantilla: Claude (aquí), Gemini
 * (plan-assistant-gemini.ts) y Groq (plan-assistant-groq.ts). La instalación elige el principal y,
 * si tiene llave de otros, quedan de respaldo (ver config.ts y fallbackPlanDrafter).
 */

export interface PlanDraftRequest {
  fields: PlanField[];
  subjectName: string;
  /** "Cuarto grado A" */
  sectionLabel: string;
  weekStart: string;
  /** Días en que la sección tiene esta clase según el horario (los cinco si no hay horario). */
  classDays: Weekday[];
  topic: string;
  notes?: string;
  /** Tema de la semana anterior en la misma clase, para dar continuidad. */
  previousTopic?: string;
  /** Idioma en que se imparte la materia (colegios bilingües). Por defecto, español. */
  language?: SubjectLanguage;
}

/** Quien arma el borrador: en producción, Claude; en las pruebas, un doble. */
export interface PlanDrafter {
  draft(request: PlanDraftRequest): Promise<PlanContent>;
}

/** Por qué no salió un borrador, con el mensaje para el docente (y la causa, para los registros). */
export class PlanDraftError extends Error {
  constructor(
    readonly reason: "refused" | "unavailable" | "incomplete",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * El motivo de una falla con sus causas encadenadas: "fetch failed" solo no dice nada, el porqué
 * (p. ej. "getaddrinfo ENOTFOUND api.groq.com") viene en la causa de la causa.
 */
export function causeChain(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause;
  const parts: string[] = [];
  let current: unknown = cause;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    parts.push(
      typeof code === "string" && !current.message.includes(code)
        ? `${current.message} (${code})`
        : current.message,
    );
    current = current.cause;
  }
  return parts.join(" ← ");
}

/**
 * Varios proveedores en fila: si el primero falla porque está ocupado, llegó a su límite, está mal
 * configurado o devolvió algo incompleto, se pide el borrador al siguiente y el docente no se entera.
 * Un rechazo por el contenido no se reintenta con otro (se respeta). Tampoco se pasa al siguiente si
 * ya se gastó más de `budgetMs` (p. ej. el primero tardó hasta agotar su tiempo): no alcanzaría antes
 * de que el panel deje de esperar.
 */
export function fallbackPlanDrafter(
  drafters: Array<{ name: string; drafter: PlanDrafter }>,
  options: {
    budgetMs?: number;
    onFallback?: (from: string, to: string, err: unknown) => void;
    now?: () => number;
  } = {},
): PlanDrafter {
  const [first, ...rest] = drafters;
  if (!first) throw new Error("fallbackPlanDrafter necesita al menos un proveedor");
  if (rest.length === 0) return first.drafter;
  const budgetMs = options.budgetMs ?? 30_000;
  const now = options.now ?? Date.now;
  return {
    async draft(request) {
      const started = now();
      for (let i = 0; ; i++) {
        const current = drafters[i] as (typeof drafters)[number];
        try {
          return await current.drafter.draft(request);
        } catch (err) {
          const next = drafters[i + 1];
          const refused = err instanceof PlanDraftError && err.reason === "refused";
          if (!next || refused || now() - started > budgetMs) throw err;
          options.onFallback?.(current.name, next.name, err);
        }
      }
    },
  };
}

/** Lo que ve el docente cuando no sale el borrador (igual con cualquier proveedor). */
export const DRAFT_MESSAGES = {
  refused:
    "El asistente no pudo preparar este borrador. Prueba con otra forma de escribir el tema o escríbela tú.",
  incomplete: "El borrador salió incompleto. Intenta de nuevo.",
  busy: "El asistente no responde en este momento. Intenta en unos minutos.",
  limit: "El asistente llegó a su límite de uso por ahora. Intenta en unos minutos.",
  misconfigured: "El asistente no está bien configurado en este servidor. Avisa al equipo de la plataforma.",
} as const;

const MODEL = "claude-opus-5-5";

export const SYSTEM_PROMPT = `Eres un asistente de planificación didáctica para docentes de centros educativos de Honduras. Redactas el borrador de la planificación semanal de una clase, alineado con el Currículo Nacional Básico (CNB) de la Secretaría de Educación. El docente lo revisa, lo ajusta y lo entrega a la dirección.

Cómo escribir el borrador:
- Español de Honduras, claro y concreto, adecuado a la edad del grado. Escribe como un docente que planifica, no como un libro de texto.
- Llena cada campo de la plantilla con lo que su nombre y su ayuda piden.
- Organiza las actividades de cada día en inicio, desarrollo y cierre, con tiempos aproximados.
- Las actividades deben poder hacerse en un aula pública con pocos recursos: pizarra, cuaderno, libro de texto y materiales del entorno. No supongas internet, proyector, computadora ni impresora, salvo que el docente diga que los tiene.
- Incluye evaluación formativa con criterios que el docente pueda observar en clase.
- Las tareas para la casa son breves y se hacen sin internet ni materiales costosos.
- En los días sin clase de esta asignatura deja el texto vacío.
- No inventes códigos, numeraciones ni citas textuales de documentos oficiales. Si un campo pide el estándar o la expectativa de logro, redacta lo que el alumno logrará al terminar la semana.
- Si el tema no corresponde al grado o a la asignatura, adáptalo a lo que sí corresponde y dilo en el campo de contenidos.`;

/**
 * Materias que se imparten en inglés (colegios bilingües, que suelen seguir el año escolar de
 * Estados Unidos): el borrador sale en inglés y no se alinea al CNB, que es para las materias en
 * español. Los nombres de los campos de la plantilla siguen en español; lo que se escribe en ellos,
 * en inglés.
 */
export const SYSTEM_PROMPT_EN = `${SYSTEM_PROMPT.replace(
  "docentes de centros educativos de Honduras. Redactas el borrador de la planificación semanal de una clase, alineado con el Currículo Nacional Básico (CNB) de la Secretaría de Educación.",
  "docentes de colegios bilingües de Honduras. Redactas el borrador de la planificación semanal de una clase que se imparte en inglés, con lo que se espera para ese grado en un colegio bilingüe (si el docente indica los estándares que sigue el colegio, por ejemplo Common Core, alinéalo a ellos).",
)
  .replace(
    "- Español de Honduras, claro y concreto, adecuado a la edad del grado.",
    "- Escribe TODO el contenido en inglés (inglés de Estados Unidos), claro y concreto, adecuado a la edad del grado y a alumnos que aprenden en inglés como segunda lengua.",
  )
  .replace("en un aula pública con pocos recursos:", "en el aula con recursos comunes:")}
- Aunque las instrucciones y los nombres de los campos estén en español, el texto de cada campo va en inglés.`;

/** Las indicaciones del sistema según el idioma de la materia. */
export const systemPromptFor = (language: SubjectLanguage = "es") =>
  language === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT;

/** El formato de la respuesta sale de la plantilla del centro: un texto por campo, o uno por día. */
function schemaFor(fields: PlanField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const description = [field.label, field.help].filter(Boolean).join(". ");
    shape[field.key] =
      field.type === "dias"
        ? z
            .object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.string()])) as Record<Weekday, z.ZodString>)
            .describe(description)
        : z.string().describe(description);
  }
  return z.object(shape);
}

const FIELD_KINDS: Record<PlanField["type"], string> = {
  texto: "una línea",
  parrafo: "uno o varios párrafos",
  dias: "un texto por día, de lunes a viernes",
};

export function draftPrompt(request: PlanDraftRequest): string {
  const days =
    request.classDays.length === WEEKDAYS.length
      ? "de lunes a viernes"
      : request.classDays.map((d) => WEEKDAY_LABELS[d].toLowerCase()).join(", ");
  const fields = request.fields
    .map((f) => `- ${f.key}: ${f.label} (${FIELD_KINDS[f.type]})${f.help ? `. ${f.help}` : ""}`)
    .join("\n");
  return [
    `Asignatura: ${request.subjectName}`,
    `Grado y sección: ${request.sectionLabel}`,
    `Semana: ${formatWeekRange(request.weekStart)}`,
    `Días con clase de esta asignatura: ${days}`,
    request.previousTopic ? `Tema de la semana anterior: ${request.previousTopic}` : null,
    `Tema de esta semana: ${request.topic}`,
    request.notes ? `Indicaciones del docente:\n${request.notes}` : null,
    request.language === "en" ? "Idioma del borrador: inglés (la asignatura se imparte en inglés)." : null,
    "",
    `Campos de la plantilla del centro:\n${fields}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * El formato de la respuesta como JSON Schema (para Gemini y Groq): un texto por campo, y en los
 * campos por día un texto por cada día. `closed` prohíbe claves de más, como pide el modo estricto.
 */
export function planJsonSchema(fields: PlanField[], options: { closed?: boolean } = {}) {
  const closed = options.closed ? { additionalProperties: false } : {};
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
            ...closed,
          }
        : { type: "string", description };
  }
  return { type: "object", properties, required: fields.map((f) => f.key), ...closed };
}

/** Quita un cerco ```json … ``` si el modelo lo agregara (con respuesta JSON no debería). */
const unfence = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

/**
 * Lee el borrador que un proveedor devolvió como texto JSON. Un campo puede quedar vacío (p. ej. sin
 * tarea esa semana), pero no la plantilla entera; si no se puede leer, sale como incompleto.
 */
export function readDraftJson(text: string, request: PlanDraftRequest, provider: string): PlanContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch (err) {
    throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, { cause: err });
  }
  const { content, errors } = parsePlanContent(request.fields, parsed);
  const filled = Object.values(content).some((v) =>
    typeof v === "string" ? v !== "" : Object.values(v ?? {}).some((day) => day !== ""),
  );
  if (Object.keys(errors).length > 0 || !filled) {
    throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete, {
      cause: new Error(`${provider} devolvió la plantilla incompleta: ${JSON.stringify(errors)}`),
    });
  }
  return onlyClassDays(request.fields, content, request.classDays);
}

/** Deja vacíos los días en que la sección no tiene esta clase. */
export function onlyClassDays(fields: PlanField[], content: PlanContent, classDays: Weekday[]): PlanContent {
  for (const field of fields) {
    if (field.type !== "dias") continue;
    const days = (content[field.key] ?? {}) as DaysValue;
    for (const day of WEEKDAYS) if (!classDays.includes(day) || typeof days[day] !== "string") days[day] = "";
    content[field.key] = days;
  }
  return content;
}

export function claudePlanDrafter(client = new Anthropic({ timeout: 120_000, maxRetries: 1 })): PlanDrafter {
  return {
    async draft(request) {
      const parse = () =>
        client.beta.messages.parse({
          model: MODEL,
          max_tokens: 16000,
          system: systemPromptFor(request.language),
          // Si el modelo declina, el servidor reintenta con el modelo que corresponda.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: betaZodOutputFormat(schemaFor(request.fields)) },
          messages: [{ role: "user", content: draftPrompt(request) }],
        });
      let response: Awaited<ReturnType<typeof parse>>;
      try {
        response = await parse();
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new PlanDraftError("unavailable", DRAFT_MESSAGES.misconfigured, { cause: err });
        }
        if (
          err instanceof Anthropic.RateLimitError ||
          err instanceof Anthropic.InternalServerError ||
          err instanceof Anthropic.APIConnectionError
        ) {
          throw new PlanDraftError("unavailable", DRAFT_MESSAGES.busy, { cause: err });
        }
        throw err;
      }
      if (response.stop_reason === "refusal") {
        throw new PlanDraftError("refused", DRAFT_MESSAGES.refused);
      }
      if (response.stop_reason === "max_tokens" || !response.parsed_output) {
        throw new PlanDraftError("incomplete", DRAFT_MESSAGES.incomplete);
      }
      const { content } = parsePlanContent(request.fields, response.parsed_output);
      return onlyClassDays(request.fields, content, request.classDays);
    },
  };
}
