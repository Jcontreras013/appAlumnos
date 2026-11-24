import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  type AssignmentDto,
  addDays,
  DEFAULT_PLAN_TEMPLATE,
  PLAN_DRAFTS_PER_DAY,
  type PlanAssistantStatusDto,
  type PlanContent,
  type PlanDetailDto,
  type PlanDraftDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claudePlanDrafter,
  draftPrompt,
  PlanDraftError,
  type PlanDrafter,
  type PlanDraftRequest,
} from "../src/lib/plan-assistant";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

/** Asistente de planificación: borrador con la plantilla del centro, sin guardar nada. */

const TODAY = "2026-11-09"; // lunes
const WEEK = TODAY;
const schoolId = randomUUID();
const fields = DEFAULT_PLAN_TEMPLATE.fields;

/** Doble del asistente: guarda lo que le piden y responde un borrador fijo (o falla, si se le indica). */
const requests: PlanDraftRequest[] = [];
let failNext: PlanDraftError | null = null;
const fakeDrafter: PlanDrafter = {
  async draft(request) {
    requests.push(request);
    if (failNext) {
      const err = failNext;
      failNext = null;
      throw err;
    }
    return Object.fromEntries(
      request.fields.map((f) => [
        f.key,
        f.type === "dias"
          ? { lunes: "Inicio…", martes: "", miercoles: "Desarrollo…", jueves: "", viernes: "Cierre…" }
          : `Borrador de ${f.label}`,
      ]),
    ) as PlanContent;
  },
};

let ctx: AcademicTestContext;
let ana: TestUser;
let ceci: TestUser;
let director: TestUser;
let assignment: AssignmentDto;
let planId: string;
let sectionId: string;

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY, planDrafter: fakeDrafter });
  director = await ctx.user("admin", schoolId);
  ana = await ctx.user("docente", schoolId, "Prof. Ana");
  ceci = await ctx.user("docente", schoolId, "Prof. Ceci");
  const s = await ctx.seedStructure(director);
  sectionId = s.sectionA.id;
  assignment = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId,
      subjectId: s.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  // La semana anterior, con su tema: el asistente lo usa para dar continuidad.
  const previous = (
    await ctx.call<PlanDetailDto>(ana, "POST", "/plans", {
      assignmentId: assignment.id,
      weekStart: addDays(WEEK, -7),
    })
  ).body;
  await ctx.call(ana, "PUT", `/plans/${previous.plan.id}`, {
    content: { tema: "Suma de fracciones" },
    version: previous.plan.version,
  });
  planId = (
    await ctx.call<PlanDetailDto>(ana, "POST", "/plans", { assignmentId: assignment.id, weekStart: WEEK })
  ).body.plan.id;
});
afterAll(() => ctx.close());

const draft = (
  who: TestUser,
  body: Record<string, unknown> = { topic: "Resta de fracciones" },
  id = planId,
) => ctx.call<PlanDraftDto & { error?: { message: string } }>(who, "POST", `/plans/${id}/draft`, body);

describe("asistente de planificación", () => {
  it("dice si está activado y cuántos borradores quedan hoy", async () => {
    const res = await ctx.call<PlanAssistantStatusDto>(ana, "GET", "/plans/assistant");
    expect(res.body).toEqual({
      enabled: true,
      remainingToday: PLAN_DRAFTS_PER_DAY,
      dailyLimit: PLAN_DRAFTS_PER_DAY,
    });
  });

  it("arma el borrador con la plantilla, la clase, el tema anterior y lo que indica el docente", async () => {
    const res = await draft(ana, { topic: "Resta de fracciones", notes: "Tenemos el libro de 4to grado." });
    expect(res.status).toBe(200);
    expect(res.body.remainingToday).toBe(PLAN_DRAFTS_PER_DAY - 1);
    expect(res.body.content.tema).toBe("Resta de fracciones");
    expect(res.body.content.actividades).toMatchObject({ lunes: "Inicio…", viernes: "Cierre…" });
    const sent = requests.at(-1);
    expect(sent).toMatchObject({
      subjectName: "Matemáticas",
      weekStart: WEEK,
      topic: "Resta de fracciones",
      notes: "Tenemos el libro de 4to grado.",
      previousTopic: "Suma de fracciones",
      classDays: ["lunes", "martes", "miercoles", "jueves", "viernes"],
    });
    expect(sent?.fields.map((f) => f.key)).toEqual(fields.map((f) => f.key));
  });

  it("no guarda nada: la planificación sigue como estaba hasta que el docente la guarda", async () => {
    const detail = await ctx.call<PlanDetailDto>(ana, "GET", `/plans/${planId}`);
    expect(detail.body.plan.content).toEqual({});
  });

  it("usa los días del horario cuando el centro lo tiene armado", async () => {
    await ctx.call(director, "PUT", "/schedule/blocks", {
      blocks: [
        { startsAt: "07:00", endsAt: "07:45" },
        { startsAt: "07:45", endsAt: "08:30" },
      ],
    });
    await ctx.call(director, "PUT", `/schedule/sections/${sectionId}`, {
      slots: [
        { weekday: 1, block: 1, assignmentId: assignment.id },
        { weekday: 3, block: 2, assignmentId: assignment.id },
      ],
    });
    expect((await draft(ana)).status).toBe(200);
    expect(requests.at(-1)?.classDays).toEqual(["lunes", "miercoles"]);
  });

  it("solo quien escribe la planificación usa el asistente", async () => {
    expect((await draft(ceci)).status).toBe(404);
    expect((await draft(director)).status).toBe(403);
    expect((await draft(ana, { topic: "" })).status).toBe(400);
  });

  it("si el modelo declina, el docente ve el motivo y no gasta un borrador", async () => {
    const before = (await ctx.call<PlanAssistantStatusDto>(ana, "GET", "/plans/assistant")).body
      .remainingToday;
    failNext = new PlanDraftError("refused", "El asistente no pudo preparar este borrador.");
    const res = await draft(ana);
    expect(res.status).toBe(422);
    expect(res.body.error?.message).toBe("El asistente no pudo preparar este borrador.");
    const after = (await ctx.call<PlanAssistantStatusDto>(ana, "GET", "/plans/assistant")).body
      .remainingToday;
    expect(after).toBe(before);
  });

  it("tiene un límite de borradores por día", async () => {
    const { remainingToday } = (await ctx.call<PlanAssistantStatusDto>(ana, "GET", "/plans/assistant")).body;
    for (let i = 0; i < remainingToday; i++) expect((await draft(ana)).status).toBe(200);
    const res = await draft(ana);
    expect(res.status).toBe(429);
    expect(res.body.error?.message).toContain(`${PLAN_DRAFTS_PER_DAY} borradores`);
  });

  it("una planificación enviada a revisión ya no se prepara con el asistente", async () => {
    const full = Object.fromEntries(
      fields.map((f) => [
        f.key,
        f.type === "dias"
          ? { lunes: "a", martes: "b", miercoles: "c", jueves: "d", viernes: "e" }
          : "Texto completo del campo",
      ]),
    );
    const { plan } = (await ctx.call<PlanDetailDto>(ana, "GET", `/plans/${planId}`)).body;
    const sent = await ctx.call<PlanDetailDto>(ana, "POST", `/plans/${planId}/submit`, {
      content: full,
      version: plan.version,
    });
    expect(sent.body.plan.status).toBe("enviada");
    expect((await draft(ana)).status).toBe(403);
  });
});

describe("sin asistente configurado", () => {
  it("aparece como no disponible y no genera borradores", async () => {
    const off = await setupAcademic({ today: TODAY });
    const teacher = await off.user("docente", schoolId);
    expect((await off.call<PlanAssistantStatusDto>(teacher, "GET", "/plans/assistant")).body.enabled).toBe(
      false,
    );
    expect(
      (await off.call(teacher, "POST", `/plans/${randomUUID()}/draft`, { topic: "Fracciones" })).status,
    ).toBe(503);
    await off.close();
  });
});

describe("asistente con Claude", () => {
  const request: PlanDraftRequest = {
    fields,
    subjectName: "Ciencias Naturales",
    sectionLabel: "Cuarto grado A",
    weekStart: WEEK,
    classDays: ["lunes", "miercoles"],
    topic: "El arrecife de coral",
  };
  /** Cliente falso con la misma forma que el SDK: responde lo que se le indique. */
  const clientReturning = (response: Record<string, unknown>) =>
    ({ beta: { messages: { parse: async () => response } } }) as unknown as Anthropic;
  const days = {
    lunes: "Inicio",
    martes: "No hay clase",
    miercoles: "Desarrollo",
    jueves: "",
    viernes: "Cierre",
  };

  it("la indicación lleva la clase y la plantilla, sin datos de alumnos", () => {
    const prompt = draftPrompt(request);
    expect(prompt).toContain("Ciencias Naturales");
    expect(prompt).toContain("Cuarto grado A");
    expect(prompt).toContain("lunes, miércoles");
    expect(prompt).toContain("El arrecife de coral");
    expect(prompt).toContain("actividades: Actividades por día");
  });

  it("devuelve la plantilla llena y deja vacíos los días sin clase", async () => {
    const parsed = Object.fromEntries(
      fields.map((f) => [f.key, f.type === "dias" ? days : `Texto de ${f.key}`]),
    );
    const content = await claudePlanDrafter(
      clientReturning({ stop_reason: "end_turn", parsed_output: parsed }),
    ).draft(request);
    expect(content.contenidos).toBe("Texto de contenidos");
    expect(content.actividades).toEqual({
      lunes: "Inicio",
      martes: "",
      miercoles: "Desarrollo",
      jueves: "",
      viernes: "",
    });
  });

  it("explica al docente cuando el modelo declina o el borrador queda incompleto", async () => {
    await expect(
      claudePlanDrafter(clientReturning({ stop_reason: "refusal", parsed_output: null })).draft(request),
    ).rejects.toMatchObject({ reason: "refused" });
    await expect(
      claudePlanDrafter(clientReturning({ stop_reason: "max_tokens", parsed_output: null })).draft(request),
    ).rejects.toMatchObject({ reason: "incomplete" });
  });
});
