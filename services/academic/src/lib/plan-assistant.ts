import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  type DaysValue,
  formatWeekRange,
  type PlanContent,
  type PlanField,
  parsePlanContent,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Weekday,
} from "@escolar/shared";
import { z } from "zod";

/**
 * Asistente de planificación: arma un borrador de la planificación semanal con los campos de la
 * plantilla del centro. Al modelo solo van la asignatura, el grado, el tema y lo que escribe el
 * docente; nunca datos de alumnos. El borrador no se guarda: el docente lo revisa y lo guarda.
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
}

/** Quien arma el borrador: en producción, Claude; en las pruebas, un doble. */
export interface PlanDrafter {
  draft(request: PlanDraftRequest): Promise<PlanContent>;
}

/** Por qué no salió un borrador, con el mensaje para el docente. */
export class PlanDraftError extends Error {
  constructor(
    readonly reason: "refused" | "unavailable" | "incomplete",
    message: string,
  ) {
    super(message);
  }
}

const MODEL = "claude-opus-5-5";

const SYSTEM = `Eres un asistente de planificación didáctica para docentes de centros educativos de Honduras. Redactas el borrador de la planificación semanal de una clase, alineado con el Currículo Nacional Básico (CNB) de la Secretaría de Educación. El docente lo revisa, lo ajusta y lo entrega a la dirección.

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
    "",
    `Campos de la plantilla del centro:\n${fields}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Deja vacíos los días en que la sección no tiene esta clase. */
function onlyClassDays(fields: PlanField[], content: PlanContent, classDays: Weekday[]): PlanContent {
  for (const field of fields) {
    if (field.type !== "dias") continue;
    const days = content[field.key] as DaysValue;
    for (const day of WEEKDAYS) if (!classDays.includes(day)) days[day] = "";
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
          system: SYSTEM,
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
          throw new PlanDraftError(
            "unavailable",
            "El asistente no está bien configurado en este servidor. Avisa al equipo de la plataforma.",
          );
        }
        if (
          err instanceof Anthropic.RateLimitError ||
          err instanceof Anthropic.InternalServerError ||
          err instanceof Anthropic.APIConnectionError
        ) {
          throw new PlanDraftError(
            "unavailable",
            "El asistente no responde en este momento. Intenta en unos minutos.",
          );
        }
        throw err;
      }
      if (response.stop_reason === "refusal") {
        throw new PlanDraftError(
          "refused",
          "El asistente no pudo preparar este borrador. Prueba con otra forma de escribir el tema o escríbela tú.",
        );
      }
      if (response.stop_reason === "max_tokens" || !response.parsed_output) {
        throw new PlanDraftError("incomplete", "El borrador salió incompleto. Intenta de nuevo.");
      }
      const { content } = parsePlanContent(request.fields, response.parsed_output);
      return onlyClassDays(request.fields, content, request.classDays);
    },
  };
}
