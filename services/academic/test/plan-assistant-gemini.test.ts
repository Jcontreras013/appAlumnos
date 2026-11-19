import { DEFAULT_PLAN_TEMPLATE, WEEKDAYS } from "@escolar/shared";
import { describe, expect, it } from "vitest";
import { planAssistantFromEnv } from "../src/config";
import { DRAFT_MESSAGES, type PlanDraftRequest, planJsonSchema } from "../src/lib/plan-assistant";
import { DEFAULT_GEMINI_MODEL, geminiPlanDrafter } from "../src/lib/plan-assistant-gemini";

/** Asistente de planificación con Gemini: la petición a Google y cómo se lee su respuesta. */

const fields = DEFAULT_PLAN_TEMPLATE.fields;
const request: PlanDraftRequest = {
  fields,
  subjectName: "Ciencias Naturales",
  sectionLabel: "Cuarto grado A",
  weekStart: "2026-11-09",
  classDays: ["lunes", "miercoles"],
  topic: "El arrecife de coral",
  notes: "Tenemos el libro de 4to grado.",
};

/** Respuesta de Gemini con la plantilla llena (el texto JSON va en la primera parte). */
const filled = () =>
  Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.type === "dias"
        ? { lunes: "Inicio", martes: "No hay clase", miercoles: "Desarrollo", jueves: "", viernes: "Cierre" }
        : `Texto de ${f.key}`,
    ]),
  );
const ok = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  candidates: [
    { content: { role: "model", parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP" },
  ],
  ...extra,
});

/** fetch falso: guarda lo que se le pidió y responde lo indicado. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const drafter = (status: number, body: unknown, model?: string) => {
  const fake = fakeFetch(status, body);
  return { ...fake, drafter: geminiPlanDrafter({ apiKey: "llave-de-prueba", model, fetchImpl: fake.impl }) };
};

describe("Gemini: la petición", () => {
  it("pide JSON con la plantilla del centro, la llave en un encabezado y sin datos de alumnos", async () => {
    const { calls, drafter: d } = drafter(200, ok(filled()));
    await d.draft(request);
    const [call] = calls;
    expect(call?.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`,
    );
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("llave-de-prueba");
    expect(call?.url).not.toContain("llave-de-prueba");
    const body = JSON.parse(String(call?.init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.required).toEqual(fields.map((f) => f.key));
    // Sin ajustes de muestreo: los modelos nuevos de Gemini los rechazan.
    expect(body.generationConfig).not.toHaveProperty("temperature");
    expect(body.systemInstruction.parts[0].text).toContain("Currículo Nacional Básico");
    const prompt = body.contents[0].parts[0].text as string;
    expect(prompt).toContain("El arrecife de coral");
    expect(prompt).toContain("Tenemos el libro de 4to grado.");
  });

  it("usa el modelo que indique la instalación", async () => {
    const { calls, drafter: d } = drafter(200, ok(filled()), "gemini-3.5-flash");
    await d.draft(request);
    expect(calls[0]?.url).toContain("/models/gemini-3.5-flash:generateContent");
  });

  it("el formato pide un texto por campo y uno por cada día en los campos por día", () => {
    const schema = planJsonSchema(fields) as {
      properties: Record<string, { type: string; required?: string[]; description?: string }>;
    };
    const days = fields.find((f) => f.type === "dias");
    const text = fields.find((f) => f.type !== "dias");
    if (!days || !text) throw new Error("la plantilla de prueba necesita ambos tipos de campo");
    expect(schema.properties[days.key]).toMatchObject({ type: "object", required: [...WEEKDAYS] });
    expect(schema.properties[text.key]).toMatchObject({ type: "string" });
    expect(schema.properties[text.key]?.description).toContain(text.label);
  });
});

describe("Gemini: la respuesta", () => {
  it("devuelve la plantilla llena y deja vacíos los días sin clase", async () => {
    const content = await drafter(200, ok(filled())).drafter.draft(request);
    const days = fields.find((f) => f.type === "dias");
    if (!days) throw new Error("falta un campo por días");
    expect(content[days.key]).toEqual({
      lunes: "Inicio",
      martes: "",
      miercoles: "Desarrollo",
      jueves: "",
      viernes: "",
    });
    const text = fields.find((f) => f.type !== "dias");
    if (!text) throw new Error("falta un campo de texto");
    expect(content[text.key]).toBe(`Texto de ${text.key}`);
  });

  it("ignora las partes de razonamiento y un cerco ```json si lo hubiera", async () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              { text: "pensando…", thought: true },
              { text: `\`\`\`json\n${JSON.stringify(filled())}\n\`\`\`` },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };
    await expect(drafter(200, body).drafter.draft(request)).resolves.toBeTruthy();
  });

  it("si Google bloquea el tema o corta por contenido, el docente ve que no se pudo", async () => {
    await expect(
      drafter(200, { promptFeedback: { blockReason: "SAFETY" } }).drafter.draft(request),
    ).rejects.toMatchObject({ reason: "refused", message: DRAFT_MESSAGES.refused });
    await expect(
      drafter(200, { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }).drafter.draft(
        request,
      ),
    ).rejects.toMatchObject({ reason: "refused" });
  });

  it("si la respuesta se corta o no trae la plantilla, sale como incompleta", async () => {
    await expect(
      drafter(200, {
        candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }],
      }).drafter.draft(request),
    ).rejects.toMatchObject({ reason: "incomplete", message: DRAFT_MESSAGES.incomplete });
    await expect(drafter(200, ok("no es una plantilla")).drafter.draft(request)).rejects.toMatchObject({
      reason: "incomplete",
    });
    await expect(drafter(200, ok({})).drafter.draft(request)).rejects.toMatchObject({ reason: "incomplete" });
  });

  it("explica el límite de la capa gratis, la llave mala y las caídas de Google", async () => {
    await expect(
      drafter(429, {
        error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" },
      }).drafter.draft(request),
    ).rejects.toMatchObject({ reason: "unavailable", message: DRAFT_MESSAGES.limit });
    const badKey = drafter(400, {
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "API key not valid",
        details: [{ reason: "API_KEY_INVALID" }],
      },
    });
    const err = await badKey.drafter.draft(request).catch((e: Error) => e);
    expect(err).toMatchObject({ reason: "unavailable", message: DRAFT_MESSAGES.misconfigured });
    // El motivo exacto queda para los registros del servicio, no para el docente.
    expect(String((err as Error).cause)).toContain("API key not valid");
    await expect(drafter(503, {}).drafter.draft(request)).rejects.toMatchObject({
      reason: "unavailable",
      message: DRAFT_MESSAGES.busy,
    });
  });

  it("si no hay conexión con Google, el asistente no responde", async () => {
    const offline = geminiPlanDrafter({
      apiKey: "x",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(offline.draft(request)).rejects.toMatchObject({
      reason: "unavailable",
      message: DRAFT_MESSAGES.busy,
    });
  });
});

describe("qué proveedor usa la instalación", () => {
  it("sin llaves no hay asistente", () => {
    expect(planAssistantFromEnv({})).toEqual({ config: null, warning: null });
  });

  it("con la llave de Gemini usa Gemini, con su modelo si se indica", () => {
    expect(planAssistantFromEnv({ GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-3.5-flash" }).config).toEqual({
      provider: "gemini",
      apiKey: "g",
      model: "gemini-3.5-flash",
    });
  });

  it("con las dos llaves usa Claude, salvo que se pida Gemini", () => {
    expect(planAssistantFromEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }).config).toEqual({
      provider: "claude",
    });
    expect(
      planAssistantFromEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", PLAN_ASSISTANT_PROVIDER: "gemini" })
        .config,
    ).toMatchObject({ provider: "gemini" });
  });

  it("si se pide un proveedor sin su llave, queda apagado con un aviso; uno desconocido no arranca", () => {
    const result = planAssistantFromEnv({ PLAN_ASSISTANT_PROVIDER: "gemini", GEMINI_API_KEY: " " });
    expect(result.config).toBeNull();
    expect(result.warning).toContain("GEMINI_API_KEY");
    expect(() => planAssistantFromEnv({ PLAN_ASSISTANT_PROVIDER: "otro" })).toThrow(/no reconocido/);
  });

  it("PLAN_ASSISTANT=off lo apaga aunque haya llave", () => {
    expect(planAssistantFromEnv({ GEMINI_API_KEY: "g", PLAN_ASSISTANT: "off" }).config).toBeNull();
  });
});
