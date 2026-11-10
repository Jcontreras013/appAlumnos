import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  LessonPlanDto,
  PlanBoardDto,
  PlanDetailDto,
  PlanTemplateDto,
} from "@escolar/shared";
import { addDays, DEFAULT_PLAN_TEMPLATE } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let coordinadora: TestUser;
let ana: TestUser; // titular de Matemáticas 1A
let beto: TestUser; // la sustituye una semana
let ceci: TestUser; // da Matemáticas 1B
let secretary: TestUser;
let math1A: AssignmentDto;
let math1B: AssignmentDto;
const schoolId = randomUUID();
const TODAY = "2026-11-09"; // lunes
const WEEK = TODAY;
const NEXT = addDays(WEEK, 7);

type ErrorBody = { error: { message: string; details?: { fields?: Array<{ path: string }> } } };

const fullContent = {
  tema: "Fracciones equivalentes",
  estandar: "Reconoce y construye fracciones equivalentes.",
  contenidos: "Fracciones, simplificación, amplificación.",
  actividades: {
    lunes: "Repaso",
    martes: "Juego de cartas",
    miercoles: "",
    jueves: "Ejercicios",
    viernes: "Prueba",
  },
  evaluacion: "Prueba corta del viernes",
};

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  coordinadora = await ctx.user("coordinador", schoolId, "Coordinadora Académica");
  ana = await ctx.user("docente", schoolId, "Ana Titular");
  beto = await ctx.user("docente", schoolId, "Beto Sustituto");
  ceci = await ctx.user("docente", schoolId, "Ceci Docente");
  secretary = await ctx.user("secretaria", schoolId, "Sofía");
  const s = await ctx.seedStructure(director);
  math1A = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: s.sectionA.id,
      subjectId: s.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  math1B = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: s.sectionB.id,
      subjectId: s.subject.id,
      teacherUserId: ceci.id,
    })
  ).body;
});
afterAll(() => ctx.close());

const create = (who: TestUser, body: Record<string, unknown>) =>
  ctx.call<PlanDetailDto & ErrorBody>(who, "POST", "/plans", body);

describe("plantilla", () => {
  it("sin configurar, el centro usa la plantilla del Currículo Nacional Básico", async () => {
    const res = await ctx.call<PlanTemplateDto>(ana, "GET", "/plan-template");
    expect(res.body).toMatchObject({ isDefault: true, deadlineDaysBefore: 3 });
    expect(res.body.fields.map((f) => f.key)).toEqual(DEFAULT_PLAN_TEMPLATE.fields.map((f) => f.key));
  });

  it("solo dirección y coordinación cambian la plantilla", async () => {
    expect((await ctx.call(ana, "PUT", "/plan-template", DEFAULT_PLAN_TEMPLATE)).status).toBe(403);
    const res = await ctx.call<PlanTemplateDto>(coordinadora, "PUT", "/plan-template", {
      ...DEFAULT_PLAN_TEMPLATE,
      deadlineDaysBefore: 2,
    });
    expect(res.body).toMatchObject({ isDefault: false, deadlineDaysBefore: 2 });
    await ctx.call(coordinadora, "PUT", "/plan-template", DEFAULT_PLAN_TEMPLATE);
  });
});

describe("planificación de una clase", () => {
  let planId: string;

  it("la maestra crea la planificación de la semana; crearla dos veces no la duplica", async () => {
    const first = await create(ana, { assignmentId: math1A.id, weekStart: WEEK });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      plan: { status: "borrador", version: 1, weekStart: WEEK, deadline: addDays(WEEK, -3) },
      canEdit: true,
      canReview: false,
    });
    planId = first.body.plan.id;
    const again = await create(ana, { assignmentId: math1A.id, weekStart: WEEK });
    expect(again.status).toBe(200);
    expect(again.body.plan.id).toBe(planId);
  });

  it("valida la semana: lunes, dentro del año y de una clase propia", async () => {
    expect((await create(ana, { assignmentId: math1A.id, weekStart: addDays(WEEK, 1) })).status).toBe(400);
    expect((await create(ana, { assignmentId: math1A.id, weekStart: "2027-03-01" })).status).toBe(400);
    expect((await create(ceci, { assignmentId: math1A.id, weekStart: WEEK })).status).toBe(403);
    // La dirección revisa; no escribe por los maestros.
    expect((await create(director, { assignmentId: math1A.id, weekStart: WEEK })).status).toBe(403);
  });

  it("guarda el contenido, descarta claves que no son de la plantilla y avisa si otra ventana guardó antes", async () => {
    const saved = await ctx.call<PlanDetailDto>(ana, "PUT", `/plans/${planId}`, {
      content: { tema: "Fracciones", intruso: "no va" },
      version: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.plan.version).toBe(2);
    expect(saved.body.plan.content.tema).toBe("Fracciones");
    expect(saved.body.plan.content).not.toHaveProperty("intruso");

    const stale = await ctx.call<ErrorBody>(ana, "PUT", `/plans/${planId}`, {
      content: { tema: "Otra" },
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toContain("otra ventana");
  });

  it("no se envía con campos obligatorios vacíos", async () => {
    const res = await ctx.call<ErrorBody>(ana, "POST", `/plans/${planId}/submit`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Estándar");
    expect(res.body.error.details?.fields?.map((f) => f.path)).toContain("actividades");
  });

  it("otros maestros no la ven; secretaría sí, pero no la edita", async () => {
    expect((await ctx.call(ceci, "GET", `/plans/${planId}`)).status).toBe(404);
    const office = await ctx.call<PlanDetailDto>(secretary, "GET", `/plans/${planId}`);
    expect(office.status).toBe(200);
    expect(office.body).toMatchObject({ canEdit: false, canReview: false });
    expect((await ctx.call(secretary, "PUT", `/plans/${planId}`, { content: fullContent })).status).toBe(403);
  });

  it("guardar y enviar en un paso; en revisión ya no se edita", async () => {
    const res = await ctx.call<PlanDetailDto>(ana, "POST", `/plans/${planId}/submit`, {
      content: fullContent,
      version: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: { status: "enviada", version: 3 }, canEdit: false });
    expect(res.body.plan.submittedAt).not.toBeNull();
    expect((await ctx.call(ana, "PUT", `/plans/${planId}`, { content: fullContent })).status).toBe(409);
  });

  it("la coordinación la devuelve con observaciones; al devolver hay que explicar", async () => {
    expect((await ctx.call(ana, "POST", `/plans/${planId}/review`, { decision: "aprobar" })).status).toBe(
      403,
    );
    const sinComentario = await ctx.call(coordinadora, "POST", `/plans/${planId}/review`, {
      decision: "devolver",
    });
    expect(sinComentario.status).toBe(400);

    const res = await ctx.call<PlanDetailDto>(coordinadora, "POST", `/plans/${planId}/review`, {
      decision: "devolver",
      comment: "Agrega cómo vas a evaluar el miércoles.",
    });
    expect(res.body.plan).toMatchObject({
      status: "devuelta",
      reviewerName: "Coordinadora Académica",
      reviewComment: "Agrega cómo vas a evaluar el miércoles.",
    });
    const forAna = await ctx.call<PlanDetailDto>(ana, "GET", `/plans/${planId}`);
    expect(forAna.body.canEdit).toBe(true);
  });

  it("la maestra corrige, la reenvía y la dirección la aprueba; queda el historial completo", async () => {
    const fixed = {
      ...fullContent,
      actividades: { ...fullContent.actividades, miercoles: "Evaluación oral" },
    };
    await ctx.call(ana, "POST", `/plans/${planId}/submit`, { content: fixed });
    const approved = await ctx.call<PlanDetailDto>(director, "POST", `/plans/${planId}/review`, {
      decision: "aprobar",
    });
    expect(approved.body.plan.status).toBe("aprobada");
    expect(approved.body.history.map((h) => h.action)).toEqual([
      "creada",
      "guardada",
      "guardada",
      "enviada",
      "devuelta",
      "guardada",
      "enviada",
      "aprobada",
    ]);
    expect(approved.body.history.find((h) => h.action === "devuelta")?.comment).toContain("miércoles");
    // Aprobada: ya no se edita ni se vuelve a revisar.
    expect((await ctx.call(ana, "PUT", `/plans/${planId}`, { content: fixed })).status).toBe(409);
    expect(
      (await ctx.call(director, "POST", `/plans/${planId}/review`, { decision: "aprobar" })).status,
    ).toBe(409);
  });

  it("la semana siguiente se puede empezar copiando la anterior", async () => {
    const recent = (await ctx.call<LessonPlanDto[]>(ana, "GET", "/plans/recent")).body;
    expect(recent.map((p) => p.id)).toContain(planId);
    const copy = await create(ana, { assignmentId: math1A.id, weekStart: NEXT, copyFromPlanId: planId });
    expect(copy.status).toBe(201);
    expect(copy.body.plan).toMatchObject({
      status: "borrador",
      content: { tema: "Fracciones equivalentes" },
    });
    expect(copy.body.history[0]?.comment).toContain("Copiada");
    // No se copia de planificaciones de otros maestros.
    const ceciPlan = await create(ceci, { assignmentId: math1B.id, weekStart: WEEK });
    const steal = await create(ana, {
      assignmentId: math1A.id,
      weekStart: addDays(NEXT, 7),
      copyFromPlanId: ceciPlan.body.plan.id,
    });
    expect(steal.status).toBe(404);
  });
});

describe("sustituciones", () => {
  it("quien cubre a la titular planifica sus clases esa semana, y solo esa", async () => {
    const later = addDays(WEEK, 14);
    const leave = await ctx.call<{ id: string }>(director, "POST", "/leaves", {
      teacherUserId: ana.id,
      type: "capacitacion",
      startsOn: addDays(later, 1),
      endsOn: addDays(later, 3),
    });
    await ctx.call(director, "POST", `/leaves/${leave.body.id}/substitutions`, {
      assignmentId: math1A.id,
      substituteUserId: beto.id,
    });
    const mine = (await ctx.call<PlanBoardDto>(beto, "GET", `/plans/mine?semana=${later}`)).body;
    expect(mine.rows.map((r) => r.assignment.id)).toEqual([math1A.id]);
    expect((await create(beto, { assignmentId: math1A.id, weekStart: later })).status).toBe(201);
    expect((await create(beto, { assignmentId: math1A.id, weekStart: addDays(later, -7) })).status).toBe(403);
    expect((await ctx.call<PlanBoardDto>(beto, "GET", `/plans/mine?semana=${WEEK}`)).body.rows).toEqual([]);
  });
});

describe("tablero de coordinación", () => {
  it("muestra el estado de cada clase en la semana y las atrasadas", async () => {
    const board = (await ctx.call<PlanBoardDto>(coordinadora, "GET", `/plans/board?semana=${NEXT}`)).body;
    expect(board.deadline).toBe(addDays(NEXT, -3));
    expect(board.rows.find((r) => r.assignment.id === math1A.id)?.status).toBe("borrador");
    expect(board.rows.find((r) => r.assignment.id === math1B.id)?.status).toBe("sin_iniciar");
    // Hoy (lunes 9) todavía no vence la del 16 (vence el viernes 13).
    expect(board.totals.atrasadas).toBe(0);

    ctx.setToday(addDays(NEXT, -2)); // sábado 14: ya venció
    const late = (await ctx.call<PlanBoardDto>(coordinadora, "GET", `/plans/board?semana=${NEXT}`)).body;
    expect(late.totals).toMatchObject({ borrador: 1, sin_iniciar: 1, atrasadas: 2 });
    ctx.setToday(TODAY);
  });

  it("el seguimiento de la dirección cuenta las planificaciones entregadas de la semana", async () => {
    const follow = (await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up")).body;
    // Semana del 9: la de Ana está aprobada (entregada); la de Ceci, en borrador.
    expect(follow.plans).toMatchObject({ weekStart: WEEK, total: 2, delivered: 1, approved: 1 });
  });

  it("los maestros no ven el tablero de todo el centro; otro centro no ve estas planificaciones", async () => {
    expect((await ctx.call(ana, "GET", "/plans/board")).status).toBe(403);
    const other = await ctx.user("admin", randomUUID(), "Otra directora");
    const board = await ctx.call<PlanBoardDto>(other, "GET", "/plans/board");
    expect(board.status).not.toBe(200);
    const recent = (await ctx.call<LessonPlanDto[]>(ana, "GET", "/plans/recent")).body;
    expect((await ctx.call(other, "GET", `/plans/${recent[0]?.id}`)).status).toBe(404);
  });
});
