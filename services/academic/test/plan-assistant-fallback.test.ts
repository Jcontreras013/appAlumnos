import { DEFAULT_PLAN_TEMPLATE, type PlanContent } from "@escolar/shared";
import { describe, expect, it } from "vitest";
import { planAssistantBackupsFromEnv, planAssistantFromEnv } from "../src/config";
import {
  DRAFT_MESSAGES,
  fallbackPlanDrafter,
  PlanDraftError,
  type PlanDrafter,
  type PlanDraftRequest,
} from "../src/lib/plan-assistant";

/** Asistente con respaldo: si el proveedor principal falla, el docente igual recibe su borrador. */

const request: PlanDraftRequest = {
  fields: DEFAULT_PLAN_TEMPLATE.fields,
  subjectName: "Matemáticas",
  sectionLabel: "Cuarto grado A",
  weekStart: "2026-11-09",
  classDays: ["lunes", "miercoles"],
  topic: "Fracciones",
};
const content = { objetivo: "Sumar fracciones" } as unknown as PlanContent;

const ok = (calls: string[], name: string): PlanDrafter => ({
  async draft() {
    calls.push(name);
    return content;
  },
});
const failing = (calls: string[], name: string, err: unknown): PlanDrafter => ({
  async draft() {
    calls.push(name);
    throw err;
  },
});
const busy = new PlanDraftError("unavailable", DRAFT_MESSAGES.limit);

describe("respaldo entre proveedores", () => {
  it("si el principal llegó a su límite, el borrador sale del siguiente y queda registrado", async () => {
    const calls: string[] = [];
    const fallbacks: string[] = [];
    const drafter = fallbackPlanDrafter(
      [
        { name: "groq", drafter: failing(calls, "groq", busy) },
        { name: "gemini", drafter: ok(calls, "gemini") },
      ],
      { onFallback: (from, to) => fallbacks.push(`${from}→${to}`) },
    );
    await expect(drafter.draft(request)).resolves.toBe(content);
    expect(calls).toEqual(["groq", "gemini"]);
    expect(fallbacks).toEqual(["groq→gemini"]);
  });

  it("también ante un error inesperado o un borrador incompleto", async () => {
    const calls: string[] = [];
    const drafter = fallbackPlanDrafter([
      { name: "groq", drafter: failing(calls, "groq", new TypeError("fetch failed")) },
      { name: "gemini", drafter: failing(calls, "gemini", new PlanDraftError("incomplete", "x")) },
      { name: "claude", drafter: ok(calls, "claude") },
    ]);
    await expect(drafter.draft(request)).resolves.toBe(content);
    expect(calls).toEqual(["groq", "gemini", "claude"]);
  });

  it("un rechazo por el contenido no se reintenta con otro proveedor", async () => {
    const calls: string[] = [];
    const refused = new PlanDraftError("refused", DRAFT_MESSAGES.refused);
    const drafter = fallbackPlanDrafter([
      { name: "groq", drafter: failing(calls, "groq", refused) },
      { name: "gemini", drafter: ok(calls, "gemini") },
    ]);
    await expect(drafter.draft(request)).rejects.toBe(refused);
    expect(calls).toEqual(["groq"]);
  });

  it("si el principal ya gastó el tiempo, no se prueba otro (el panel no alcanzaría a esperar)", async () => {
    const calls: string[] = [];
    let clock = 0;
    const slow: PlanDrafter = {
      async draft() {
        calls.push("groq");
        clock += 120_000;
        throw new PlanDraftError("unavailable", DRAFT_MESSAGES.busy);
      },
    };
    const drafter = fallbackPlanDrafter(
      [
        { name: "groq", drafter: slow },
        { name: "gemini", drafter: ok(calls, "gemini") },
      ],
      { now: () => clock },
    );
    await expect(drafter.draft(request)).rejects.toThrow(DRAFT_MESSAGES.busy);
    expect(calls).toEqual(["groq"]);
  });

  it("si todos fallan, el docente ve el motivo del último", async () => {
    const drafter = fallbackPlanDrafter([
      { name: "groq", drafter: failing([], "groq", busy) },
      {
        name: "gemini",
        drafter: failing([], "gemini", new PlanDraftError("unavailable", DRAFT_MESSAGES.busy)),
      },
    ]);
    await expect(drafter.draft(request)).rejects.toThrow(DRAFT_MESSAGES.busy);
  });

  it("con un solo proveedor queda igual que antes", () => {
    const single = ok([], "groq");
    expect(fallbackPlanDrafter([{ name: "groq", drafter: single }])).toBe(single);
  });
});

describe("qué proveedores quedan de respaldo", () => {
  it("los demás que tienen llave, en el orden de siempre", () => {
    const env = {
      GROQ_API_KEY: "q",
      GEMINI_API_KEY: "g",
      ANTHROPIC_API_KEY: "a",
      PLAN_ASSISTANT_PROVIDER: "groq",
    };
    const primary = planAssistantFromEnv(env).config;
    expect(planAssistantBackupsFromEnv(env, primary)).toEqual([
      { provider: "claude" },
      { provider: "gemini", apiKey: "g", model: undefined },
    ]);
  });

  it("sin otras llaves, sin asistente o con PLAN_ASSISTANT_FALLBACK=off, no hay respaldo", () => {
    const only = { GROQ_API_KEY: "q" };
    expect(planAssistantBackupsFromEnv(only, planAssistantFromEnv(only).config)).toEqual([]);
    expect(planAssistantBackupsFromEnv({ GEMINI_API_KEY: "g" }, null)).toEqual([]);
    const off = { GROQ_API_KEY: "q", GEMINI_API_KEY: "g", PLAN_ASSISTANT_FALLBACK: "off" };
    expect(planAssistantBackupsFromEnv(off, planAssistantFromEnv(off).config)).toEqual([]);
  });
});
