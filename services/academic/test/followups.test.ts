import { randomUUID } from "node:crypto";
import type { FollowUpDto, SchoolFollowUpDto, StudentDetailDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Seguimiento de alumnos en riesgo: qué se hizo con cada uno y qué se acordó. */

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let director: TestUser;
let coordinator: TestUser;
let secretary: TestUser;
let teacher: TestUser;
let studentId: string;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora Ruiz");
  coordinator = await ctx.user("coordinador", schoolId, "Coordinadora Paz");
  secretary = await ctx.user("secretaria", schoolId);
  teacher = await ctx.user("docente", schoolId);
  const s = await ctx.seedStructure(director);
  studentId = (
    await ctx.call<StudentDetailDto>(director, "POST", "/students", {
      firstNames: "Luis",
      lastNames: "Alumno",
      guardians: [guardian()],
      sectionId: s.sectionA.id,
    })
  ).body.id;
  // Cinco ausencias en la última semana: queda en riesgo.
  for (const date of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]) {
    await ctx.call(director, "PUT", "/attendance", {
      sectionId: s.sectionA.id,
      date,
      entries: [{ studentId, status: "ausente" }],
    });
  }
});
afterAll(() => ctx.close());

const add = (who: TestUser, body: object, id = studentId) =>
  ctx.call<FollowUpDto & { error?: { message: string } }>(who, "POST", `/students/${id}/follow-ups`, body);
const risk = async () =>
  (await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up")).body.studentsAtRisk.find(
    (s) => s.studentId === studentId,
  );

describe("seguimiento de alumnos en riesgo", () => {
  it("el alumno aparece en riesgo sin seguimiento todavía", async () => {
    expect(await risk()).toMatchObject({ absences: 5, followUps: 0, lastFollowUp: null });
  });

  it("la dirección y coordinación registran lo que hicieron; queda en la lista de riesgo", async () => {
    const call = await add(director, {
      kind: "llamada",
      date: "2026-11-06",
      notes: "La mamá dice que estuvo enfermo.",
    });
    expect(call.status).toBe(201);
    expect(call.body).toMatchObject({ kind: "llamada", authorName: "Directora Ruiz", canDelete: true });
    await add(coordinator, { kind: "reunion", date: TODAY, notes: "Se acordó traer constancia médica." });
    expect(await risk()).toMatchObject({ followUps: 2, lastFollowUp: { kind: "reunion", date: TODAY } });

    const list = (await ctx.call<FollowUpDto[]>(secretary, "GET", `/students/${studentId}/follow-ups`)).body;
    expect(list.map((f) => f.kind)).toEqual(["reunion", "llamada"]);
  });

  it("valida la fecha y el texto; secretaría y docentes no registran", async () => {
    expect((await add(director, { kind: "llamada", date: "2026-11-10", notes: "Mañana" })).status).toBe(400);
    expect((await add(director, { kind: "llamada", date: TODAY, notes: "" })).status).toBe(400);
    expect((await add(director, { kind: "magia", date: TODAY, notes: "Algo" })).status).toBe(400);
    expect((await add(secretary, { kind: "llamada", date: TODAY, notes: "Llamé" })).status).toBe(403);
    expect((await add(teacher, { kind: "llamada", date: TODAY, notes: "Llamé" })).status).toBe(403);
  });

  it("solo quien lo registró o la dirección lo borra; otro centro no ve nada", async () => {
    const list = (await ctx.call<FollowUpDto[]>(coordinator, "GET", `/students/${studentId}/follow-ups`))
      .body;
    const byDirector = list.find((f) => f.kind === "llamada") as FollowUpDto;
    const byCoordinator = list.find((f) => f.kind === "reunion") as FollowUpDto;
    expect(byDirector.canDelete).toBe(false);
    expect((await ctx.call(coordinator, "DELETE", `/follow-ups/${byDirector.id}`)).status).toBe(403);
    expect((await ctx.call(director, "DELETE", `/follow-ups/${byCoordinator.id}`)).status).toBe(204);

    const other = await ctx.user("admin", randomUUID());
    expect((await ctx.call(other, "GET", `/students/${studentId}/follow-ups`)).status).toBe(404);
    expect((await add(other, { kind: "llamada", date: TODAY, notes: "Intruso" })).status).toBe(404);
    expect((await ctx.call(other, "DELETE", `/follow-ups/${byDirector.id}`)).status).toBe(404);
  });
});
