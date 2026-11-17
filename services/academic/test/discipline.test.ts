import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  DisciplineDto,
  DisciplineOverviewDto,
  FamilyDisciplineDto,
  PortalAccessDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Disciplina: llamados de atención y medidas, quién puede registrar cada una y qué ve la familia. */

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let director: TestUser;
let coordinator: TestUser;
let secretary: TestUser;
let ana: TestUser;
let beto: TestUser;
let luis: StudentDetailDto;
let sofia: StudentDetailDto;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora Ruiz");
  coordinator = await ctx.user("coordinador", schoolId, "Coordinadora Paz");
  secretary = await ctx.user("secretaria", schoolId);
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  beto = await ctx.user("docente", schoolId, "Beto Maestro");
  const s = await ctx.seedStructure(director);
  for (const [section, teacher] of [
    [s.sectionA.id, ana],
    [s.sectionB.id, beto],
  ] as const) {
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: section,
      subjectId: s.subject.id,
      teacherUserId: teacher.id,
    });
  }
  const create = async (firstNames: string, sectionId: string, g: Record<string, unknown>) =>
    (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames,
        lastNames: "López",
        guardians: [guardian(g)],
        sectionId,
      })
    ).body;
  luis = await create("Luis", s.sectionA.id, { nationalId: "0801198501234" });
  sofia = await create("Sofía", s.sectionB.id, { fullName: "Carmen Díaz", nationalId: "0801198505678" });
});
afterAll(() => ctx.close());

const add = (who: TestUser, studentId: string, body: object) =>
  ctx.call<DisciplineDto & { error?: { message: string } }>(
    who,
    "POST",
    `/students/${studentId}/discipline`,
    body,
  );
const llamado = {
  kind: "llamado_escrito",
  severity: "leve",
  date: "2026-11-06",
  description: "Usó el celular en el examen.",
};

describe("disciplina", () => {
  it("la maestra anota un llamado de atención a su alumno, no a los de otra sección", async () => {
    const res = await add(ana, luis.id, {
      ...llamado,
      measure: "Se le retuvo el celular.",
      notifyFamily: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "llamado_escrito",
      studentName: "López, Luis",
      sectionLabel: "Primer grado A",
      authorName: "Ana Maestra",
      notifyFamily: true,
      canDelete: true,
    });
    expect((await add(ana, sofia.id, llamado)).status).toBe(404);
    expect(
      (await add(ana, luis.id, { ...llamado, kind: "llamado_verbal", notifyFamily: false })).status,
    ).toBe(201);
  });

  it("la suspensión y la expulsión solo las registra la dirección", async () => {
    const susp = {
      ...llamado,
      kind: "suspension",
      severity: "grave",
      suspensionFrom: "2026-11-09",
      suspensionTo: "2026-11-11",
    };
    const byTeacher = await add(ana, luis.id, susp);
    expect(byTeacher.status).toBe(403);
    expect(byTeacher.body.error?.message).toContain("solo las registra la dirección");
    expect((await add(coordinator, luis.id, susp)).status).toBe(403);
    expect((await add(coordinator, luis.id, { ...llamado, kind: "compromiso" })).status).toBe(201);
    expect((await add(secretary, luis.id, llamado)).status).toBe(403);
  });

  it("la suspensión pide sus fechas; queda vigente en el resumen", async () => {
    const sinFechas = await add(director, luis.id, { ...llamado, kind: "suspension", severity: "grave" });
    expect(sinFechas.status).toBe(400);
    const ok = await add(director, luis.id, {
      ...llamado,
      kind: "suspension",
      severity: "grave",
      description: "Pelea en el recreo.",
      suspensionFrom: "2026-11-09",
      suspensionTo: "2026-11-11",
      notifyFamily: true,
    });
    expect(ok.status).toBe(201);
    const overview = (await ctx.call<DisciplineOverviewDto>(director, "GET", "/discipline")).body;
    expect(overview.activeSuspensions.map((d) => d.studentName)).toEqual(["López, Luis"]);
    expect(overview.kinds).toContain("expulsion");
    expect(overview.students.map((s) => s.name).sort()).toEqual(["López, Luis", "López, Sofía"]);
  });

  it("no acepta fechas futuras", async () => {
    expect((await add(director, luis.id, { ...llamado, date: "2026-11-10" })).status).toBe(400);
  });

  it("la maestra solo ve a sus alumnos; secretaría consulta sin registrar", async () => {
    const mine = (await ctx.call<DisciplineOverviewDto>(ana, "GET", "/discipline")).body;
    expect(mine.kinds).toEqual(["llamado_verbal", "llamado_escrito", "citacion"]);
    expect(mine.students.map((s) => s.name)).toEqual(["López, Luis"]);
    expect(mine.recent.every((d) => d.studentId === luis.id)).toBe(true);
    expect((await ctx.call(beto, "GET", `/students/${luis.id}/discipline`)).status).toBe(404);

    const sec = (await ctx.call<DisciplineOverviewDto>(secretary, "GET", "/discipline")).body;
    expect(sec.kinds).toEqual([]);
    expect(sec.students).toEqual([]);
    expect(sec.recent.length).toBe(4);
  });

  it("la familia ve solo lo que se le avisó", async () => {
    const access = (
      await ctx.call<PortalAccessDto>(
        secretary,
        "POST",
        `/guardians/${luis.guardians[0]?.id}/portal-access`,
        {},
      )
    ).body;
    const mom = await ctx.user("padre", schoolId, "María López Castro", access.userId);
    const seen = (await ctx.call<FamilyDisciplineDto[]>(mom, "GET", `/family/children/${luis.id}/discipline`))
      .body;
    expect(seen.map((d) => d.kind)).toEqual(["suspension", "llamado_escrito"]);
    expect(seen[0]).not.toHaveProperty("authorName");
    expect((await ctx.call(mom, "GET", `/family/children/${sofia.id}/discipline`)).status).toBe(404);
  });

  it("solo quien lo anotó o la dirección lo borra", async () => {
    const list = (await ctx.call<DisciplineDto[]>(director, "GET", `/students/${luis.id}/discipline`)).body;
    const verbal = list.find((d) => d.kind === "llamado_verbal") as DisciplineDto;
    expect((await ctx.call(beto, "DELETE", `/discipline/${verbal.id}`)).status).toBe(403);
    expect((await ctx.call(ana, "DELETE", `/discipline/${verbal.id}`)).status).toBe(204);
    const compromiso = list.find((d) => d.kind === "compromiso") as DisciplineDto;
    expect((await ctx.call(director, "DELETE", `/discipline/${compromiso.id}`)).status).toBe(204);
  });

  it("la expulsión retira la matrícula del año", async () => {
    const res = await add(director, sofia.id, {
      ...llamado,
      kind: "expulsion",
      severity: "muy_grave",
      description: "Agresión grave a un compañero.",
      notifyFamily: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.sectionLabel).toBe("Primer grado B");
    const betoView = (await ctx.call<DisciplineOverviewDto>(beto, "GET", "/discipline")).body;
    expect(betoView.students).toEqual([]);
    const detail = (await ctx.call<StudentDetailDto>(director, "GET", `/students/${sofia.id}`)).body;
    expect(JSON.stringify(detail)).toContain("Expulsión");
  });

  it("otro centro no ve nada", async () => {
    const other = await ctx.user("admin", randomUUID());
    expect((await ctx.call(other, "GET", `/students/${luis.id}/discipline`)).status).toBe(404);
    expect((await ctx.call<DisciplineOverviewDto>(other, "GET", "/discipline")).body.recent).toEqual([]);
  });
});
