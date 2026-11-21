import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  AttendanceSheetDto,
  CoverageDto,
  DayOffDto,
  FamilyChildDto,
  PlanBoardDto,
  PlanContent,
  PlanDetailDto,
  SchoolCalendarDto,
  SchoolFollowUpDto,
  StudentDetailDto,
  SubjectDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  draftPrompt,
  type PlanDrafter,
  type PlanDraftRequest,
  SYSTEM_PROMPT,
  systemPromptFor,
} from "../src/lib/plan-assistant";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Calendario escolar (feriados y vacaciones) e idioma de las materias en colegios bilingües. */

const requests: PlanDraftRequest[] = [];
const fakeDrafter: PlanDrafter = {
  async draft(request) {
    requests.push(request);
    return Object.fromEntries(
      request.fields.map((f) => [f.key, f.type === "dias" ? {} : "Draft"]),
    ) as PlanContent;
  },
};

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
let assignment: AssignmentDto;
let studentId: string;
const schoolId = randomUUID();
const TODAY = "2026-11-09"; // lunes

const addDayOff = (who: TestUser, body: Record<string, unknown>) =>
  ctx.call<DayOffDto & { error?: { message: string } }>(who, "POST", "/calendar/days-off", body);

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY, planDrafter: fakeDrafter });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Prof. Ana");
  structure = await ctx.seedStructure(director);
  assignment = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: structure.sectionA.id,
      subjectId: structure.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  studentId = (
    await ctx.call<StudentDetailDto>(director, "POST", "/students", {
      firstNames: "Kim",
      lastNames: "Alumna",
      guardians: [guardian()],
      sectionId: structure.sectionA.id,
    })
  ).body.id;
});
afterAll(() => ctx.close());

describe("la secretaría marca el calendario escolar", () => {
  it("marca un feriado y una semana de vacaciones; el maestro no puede marcar", async () => {
    const holiday = await addDayOff(secretary, {
      name: "Feriado de prueba",
      kind: "feriado",
      startsOn: "2026-11-11",
    });
    expect(holiday.status).toBe(201);
    expect(holiday.body).toMatchObject({ startsOn: "2026-11-11", endsOn: "2026-11-11", kind: "feriado" });
    const week = await addDayOff(director, {
      name: "Semana de vacaciones",
      kind: "vacaciones",
      startsOn: "2026-11-16",
      endsOn: "2026-11-20",
    });
    expect(week.status).toBe(201);
    expect((await addDayOff(ana, { name: "Libre", kind: "otro", startsOn: "2026-11-13" })).status).toBe(403);
  });

  it("las fechas tienen que estar dentro del año lectivo y en orden", async () => {
    const outside = await addDayOff(secretary, {
      name: "Navidad",
      kind: "vacaciones",
      startsOn: "2026-12-21",
    });
    expect(outside.status).toBe(400);
    expect(outside.body.error?.message).toMatch(/dentro de un año lectivo/);
    const reversed = await addDayOff(secretary, {
      name: "Al revés",
      kind: "otro",
      startsOn: "2026-11-20",
      endsOn: "2026-11-18",
    });
    expect(reversed.status).toBe(400);
  });

  it("todo el personal ve el calendario y si hoy hay clases", async () => {
    const view = await ctx.call<SchoolCalendarDto>(ana, "GET", "/calendar");
    expect(view.body.daysOff.map((d) => d.name)).toEqual(["Feriado de prueba", "Semana de vacaciones"]);
    expect(view.body.canEdit).toBe(false);
    expect(view.body.today).toBeNull();
    ctx.setToday("2026-11-17");
    const during = await ctx.call<SchoolCalendarDto>(secretary, "GET", "/calendar");
    expect(during.body.today?.name).toBe("Semana de vacaciones");
    expect(during.body.canEdit).toBe(true);
    ctx.setToday(TODAY);
  });
});

describe("en los días sin clases no se pide nada", () => {
  it("la lista de asistencia de un feriado lo dice", async () => {
    const sheet = await ctx.call<AttendanceSheetDto>(
      ana,
      "GET",
      `/attendance/${structure.sectionA.id}?fecha=2026-11-11`,
    );
    expect(sheet.body.dayOff?.name).toBe("Feriado de prueba");
    const normal = await ctx.call<AttendanceSheetDto>(ana, "GET", `/attendance/${structure.sectionA.id}`);
    expect(normal.body.dayOff).toBeNull();
  });

  it("el seguimiento sabe que hoy no hay clases", async () => {
    ctx.setToday("2026-11-11");
    const follow = await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up");
    expect(follow.body.attendance.dayOff?.name).toBe("Feriado de prueba");
    ctx.setToday(TODAY);
  });

  it("una semana de vacaciones no pide planificación: nada queda atrasado", async () => {
    ctx.setToday("2026-11-18");
    const vacation = await ctx.call<PlanBoardDto>(director, "GET", "/plans/board?semana=2026-11-16");
    expect(vacation.body.dayOff?.name).toBe("Semana de vacaciones");
    expect(vacation.body.totals.atrasadas).toBe(0);
    const before = await ctx.call<PlanBoardDto>(director, "GET", "/plans/board?semana=2026-11-09");
    expect(before.body.dayOff).toBeNull();
    expect(before.body.totals.atrasadas).toBe(1);
    ctx.setToday(TODAY);
  });

  it("con una licencia sin sustituto, en el feriado ninguna clase queda «sin maestro»", async () => {
    const leave = await ctx.call(director, "POST", "/leaves", {
      teacherUserId: ana.id,
      type: "enfermedad",
      startsOn: "2026-11-10",
      endsOn: "2026-11-12",
    });
    expect(leave.status).toBe(201);
    const holiday = await ctx.call<CoverageDto>(director, "GET", "/coverage?fecha=2026-11-11");
    expect(holiday.body.dayOff?.name).toBe("Feriado de prueba");
    expect(holiday.body.totals.sin_cubrir).toBe(0);
    const workday = await ctx.call<CoverageDto>(director, "GET", "/coverage?fecha=2026-11-12");
    expect(workday.body.totals.sin_cubrir).toBe(1);
  });

  it("las familias ven los próximos feriados y vacaciones", async () => {
    const card = await ctx.call<FamilyChildDto>(director, "GET", `/students/${studentId}/report-card`);
    expect(card.body.upcomingDaysOff.map((d) => d.name)).toEqual([
      "Feriado de prueba",
      "Semana de vacaciones",
    ]);
  });

  it("al quitarlo del calendario, el día vuelve a ser de clases", async () => {
    const view = await ctx.call<SchoolCalendarDto>(secretary, "GET", "/calendar");
    const holiday = view.body.daysOff.find((d) => d.kind === "feriado");
    const res = await ctx.call(secretary, "DELETE", `/calendar/days-off/${holiday?.id}`);
    expect(res.status).toBe(204);
    const sheet = await ctx.call<AttendanceSheetDto>(
      ana,
      "GET",
      `/attendance/${structure.sectionA.id}?fecha=2026-11-11`,
    );
    expect(sheet.body.dayOff).toBeNull();
    // Se vuelve a marcar para la prueba del asistente.
    await addDayOff(secretary, { name: "Feriado de prueba", kind: "feriado", startsOn: "2026-11-11" });
  });
});

describe("materias en inglés (colegios bilingües)", () => {
  it("la materia se marca «en inglés» y se conserva al renombrarla", async () => {
    const english = await ctx.call<SubjectDto>(director, "PUT", `/subjects/${structure.subject.id}`, {
      name: "Math",
      language: "en",
    });
    expect(english.body.language).toBe("en");
    const renamed = await ctx.call<SubjectDto>(director, "PUT", `/subjects/${structure.subject.id}`, {
      name: "Mathematics",
    });
    expect(renamed.body.language).toBe("en");
    const created = await ctx.call<SubjectDto>(director, "POST", "/subjects", { name: "Ciencias Sociales" });
    expect(created.body.language).toBe("es");
    const classes = await ctx.call<AssignmentDto[]>(director, "GET", "/assignments");
    expect(classes.body.find((a) => a.id === assignment.id)?.subjectLanguage).toBe("en");
  });

  it("el asistente planifica en inglés y deja fuera el feriado de esa semana", async () => {
    const plan = await ctx.call<PlanDetailDto>(ana, "POST", "/plans", {
      assignmentId: assignment.id,
      weekStart: "2026-11-09",
    });
    expect(plan.status).toBe(201);
    const draft = await ctx.call(ana, "POST", `/plans/${plan.body.plan.id}/draft`, { topic: "Fractions" });
    expect(draft.status).toBe(200);
    const request = requests.at(-1);
    expect(request?.language).toBe("en");
    expect(request?.classDays).toEqual(["lunes", "martes", "jueves", "viernes"]);
  });

  it("las indicaciones al asistente piden el borrador en inglés (con cualquier proveedor)", () => {
    expect(systemPromptFor("es")).toBe(SYSTEM_PROMPT);
    const en = systemPromptFor("en");
    expect(en).not.toBe(SYSTEM_PROMPT);
    expect(en).toContain("TODO el contenido en inglés");
    expect(en).not.toContain("Currículo Nacional Básico");
    const request = requests.at(-1) as PlanDraftRequest;
    expect(draftPrompt(request)).toContain("Idioma del borrador: inglés");
    expect(draftPrompt({ ...request, language: "es" })).not.toContain("Idioma del borrador");
  });
});
