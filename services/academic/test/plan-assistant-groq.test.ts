import { DEFAULT_PLAN_TEMPLATE } from "@escolar/shared";
import { describe, expect, it } from "vitest";
import { planAssistantFromEnv } from "../src/config";
import { causeChain, DRAFT_MESSAGES, type PlanDraftRequest } from "../src/lib/plan-assistant";
import { DEFAULT_GROQ_MODEL, groqPlanDrafter } from "../src/lib/plan-assistant-groq";

/** Asistente de planificación con Groq: la petición y cómo se lee su respuesta. */

const fields = DEFAULT_PLAN_TEMPLATE.fields;
const request: PlanDraftRequest = {
  fields,
  subjectName: "Matemáticas",
  sectionLabel: "Cuarto grado A",
  weekStart: "2026-11-16",
  classDays: ["lunes", "miercoles", "viernes"],
  topic: "Fracciones",
  notes: "Libro de Matemáticas de 4to grado.",
};

/** La plantilla llena, como la devolvería el modelo. */
const filled = () =>
  Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.type === "dias"
        ? { lunes: "Inicio", martes: "No hay clase", miercoles: "Desarrollo", jueves: "", viernes: "Cierre" }
        : `Texto de ${f.key}`,
    ]),
  );
const ok = (content: unknown, finish = "stop") => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: typeof content === "string" ? content : JSON.stringify(content),
      },
      finish_reason: finish,
    },
  ],
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
  return { ...fake, drafter: groqPlanDrafter({ apiKey: "gsk_prueba", model, fetchImpl: fake.impl }) };
};

const sentBody = (calls: { init: RequestInit }[]) => JSON.parse(String(calls[0]?.init.body));

describe("Groq: la petición", () => {
  it("pide la plantilla con formato estricto, la llave en el encabezado y sin datos de alumnos", async () => {
    const { calls, drafter: d } = drafter(200, ok(filled()));
    await d.draft(request);
    expect(calls[0]?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer gsk_prueba");
    const body = sentBody(calls);
    expect(body.model).toBe(DEFAULT_GROQ_MODEL);
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("Currículo Nacional Básico");
    expect(body.messages[1].content).toContain("Fracciones");
    expect(body.messages[1].content).toContain("Libro de Matemáticas de 4to grado.");
    const format = body.response_format;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    // El modo estricto pide que el formato no admita claves de más, también en los campos por día.
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    expect(format.json_schema.schema.required).toEqual(fields.map((f) => f.key));
    const days = fields.find((f) => f.type === "dias");
    if (!days) throw new Error("la plantilla de prueba necesita un campo por días");
    expect(format.json_schema.schema.properties[days.key].additionalProperties).toBe(false);
    // GPT-OSS razona: se le pide un esfuerzo medio y que no devuelva el razonamiento.
    expect(body).toMatchObject({ reasoning_effort: "medium", include_reasoning: false });
  });

  it("con un modelo que no es GPT-OSS no manda ajustes de razonamiento ni el modo estricto", async () => {
    const { calls, drafter: d } = drafter(200, ok(filled()), "llama-3.3-70b-versatile");
    await d.draft(request);
    const body = sentBody(calls);
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("include_reasoning");
    expect(body.response_format.json_schema.strict).toBe(false);
  });
});

describe("Groq: la respuesta", () => {
  it("devuelve la plantilla llena y deja vacíos los días sin clase", async () => {
    const content = await drafter(200, ok(filled())).drafter.draft(request);
    const days = fields.find((f) => f.type === "dias");
    if (!days) throw new Error("falta un campo por días");
    expect(content[days.key]).toEqual({
      lunes: "Inicio",
      martes: "",
      miercoles: "Desarrollo",
      jueves: "",
      viernes: "Cierre",
    });
  });

  it("si la respuesta se corta o no trae la plantilla, sale como incompleta", async () => {
    await expect(drafter(200, ok("{", "length")).drafter.draft(request)).rejects.toMatchObject({
      reason: "incomplete",
      message: DRAFT_MESSAGES.incomplete,
    });
    await expect(drafter(200, ok({})).drafter.draft(request)).rejects.toMatchObject({ reason: "incomplete" });
    await expect(drafter(200, { choices: [] }).drafter.draft(request)).rejects.toMatchObject({
      reason: "incomplete",
    });
    // Groq avisa con 400 json_validate_failed cuando lo escrito no cumple el formato.
    await expect(
      drafter(400, {
        error: {
          message: "Failed to validate JSON",
          type: "invalid_request_error",
          code: "json_validate_failed",
        },
      }).drafter.draft(request),
    ).rejects.toMatchObject({ reason: "incomplete" });
  });

  it("si el modelo no quiere responder, el docente ve que no se pudo", async () => {
    await expect(drafter(200, ok("", "content_filter")).drafter.draft(request)).rejects.toMatchObject({
      reason: "refused",
      message: DRAFT_MESSAGES.refused,
    });
  });

  it("explica el límite de la capa gratis, la llave mala y las caídas de Groq", async () => {
    await expect(
      drafter(429, {
        error: { message: "Rate limit reached", type: "tokens", code: "rate_limit_exceeded" },
      }).drafter.draft(request),
    ).rejects.toMatchObject({ reason: "unavailable", message: DRAFT_MESSAGES.limit });

    const badKey = drafter(401, {
      error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" },
    });
    const err = await badKey.drafter.draft(request).catch((e: Error) => e);
    expect(err).toMatchObject({ reason: "unavailable", message: DRAFT_MESSAGES.misconfigured });
    // El motivo exacto queda para los registros del servicio, no para el docente.
    expect(String((err as Error).cause)).toContain("401 invalid_api_key: Invalid API Key");

    await expect(
      drafter(404, { error: { message: "The model does not exist", code: "model_not_found" } }).drafter.draft(
        request,
      ),
    ).rejects.toMatchObject({ message: DRAFT_MESSAGES.misconfigured });
    await expect(drafter(503, {}).drafter.draft(request)).rejects.toMatchObject({
      reason: "unavailable",
      message: DRAFT_MESSAGES.busy,
    });
    await expect(drafter(498, {}).drafter.draft(request)).rejects.toMatchObject({
      message: DRAFT_MESSAGES.busy,
    });
  });

  it("si no hay conexión con Groq, el asistente no responde", async () => {
    const offline = groqPlanDrafter({
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

describe("Groq en la configuración", () => {
  it("con solo la llave de Groq usa Groq, con su modelo si se indica", () => {
    expect(planAssistantFromEnv({ GROQ_API_KEY: "q", GROQ_MODEL: "openai/gpt-oss-20b" }).config).toEqual({
      provider: "groq",
      apiKey: "q",
      model: "openai/gpt-oss-20b",
    });
  });

  it("con varias llaves va Claude, luego Gemini, luego Groq; PLAN_ASSISTANT_PROVIDER manda", () => {
    expect(planAssistantFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }).config).toMatchObject({
      provider: "gemini",
    });
    expect(
      planAssistantFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", PLAN_ASSISTANT_PROVIDER: "Groq" })
        .config,
    ).toMatchObject({ provider: "groq", apiKey: "q" });
  });

  it("si se pide Groq sin su llave, queda apagado con un aviso", () => {
    const result = planAssistantFromEnv({ PLAN_ASSISTANT_PROVIDER: "groq", GEMINI_API_KEY: "g" });
    expect(result.config).toBeNull();
    expect(result.warning).toContain("GROQ_API_KEY");
  });

  it("un proveedor desconocido no arranca, aunque coincida con algo heredado de los objetos", () => {
    expect(() => planAssistantFromEnv({ PLAN_ASSISTANT_PROVIDER: "constructor" })).toThrow(/no reconocido/);
  });
});

describe("el motivo en los registros", () => {
  it("incluye las causas encadenadas de una falla de conexión", () => {
    const dns = Object.assign(new Error("getaddrinfo ENOTFOUND api.groq.com"), { code: "ENOTFOUND" });
    const fetchFailed = new TypeError("fetch failed", { cause: dns });
    expect(causeChain(fetchFailed)).toBe("fetch failed ← getaddrinfo ENOTFOUND api.groq.com");
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(causeChain(new TypeError("fetch failed", { cause: reset }))).toBe(
      "fetch failed ← socket hang up (ECONNRESET)",
    );
    expect(causeChain("texto")).toBe("texto");
  });
});
