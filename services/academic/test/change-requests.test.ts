import { randomUUID } from "node:crypto";
import type { ChangeRequestDto, GradeDto, LeaveDto, SubjectDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let coordinator: TestUser;
let ana: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  coordinator = await ctx.user("coordinador", schoolId, "Coordinador");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  structure = await ctx.seedStructure(director);
});
afterAll(() => ctx.close());

const ask = (kind: string, payload: Record<string, unknown>) =>
  ctx.call<ChangeRequestDto & { error?: { message: string } }>(secretary, "POST", "/change-requests", {
    kind,
    payload,
  });

describe("solicitudes de la secretaría", () => {
  it("pide un grado: queda por confirmar y no se crea todavía", async () => {
    const res = await ask("grado", { name: "Octavo grado", sortOrder: 8 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "pendiente", summary: "Crear el grado «Octavo grado»" });
    const grades = await ctx.call<GradeDto[]>(director, "GET", "/grades");
    expect(grades.body.map((g) => g.name)).not.toContain("Octavo grado");
  });

  it("valida los datos como el formulario de la dirección", async () => {
    expect((await ask("grado", { name: "" })).status).toBe(400);
    expect(
      (await ask("seccion", { gradeId: randomUUID(), schoolYearId: structure.year.id, name: "C" })).status,
    ).toBe(404);
  });

  it("solo la secretaría pide; solo la dirección confirma", async () => {
    const asCoord = await ctx.call(coordinator, "POST", "/change-requests", {
      kind: "materia",
      payload: { name: "Inglés" },
    });
    expect(asCoord.status).toBe(403);
    const list = await ctx.call<ChangeRequestDto[]>(secretary, "GET", "/change-requests");
    const id = list.body[0]?.id;
    expect((await ctx.call(secretary, "POST", `/change-requests/${id}/approve`)).status).toBe(403);
  });

  it("la dirección la confirma y entonces se crea, con quién lo pidió en la bitácora", async () => {
    const list = await ctx.call<ChangeRequestDto[]>(director, "GET", "/change-requests?estado=pendiente");
    const grade = list.body.find((r) => r.kind === "grado");
    const count = await ctx.call<{ count: number }>(director, "GET", "/change-requests/pending-count");
    expect(count.body.count).toBe(1);
    const res = await ctx.call<ChangeRequestDto>(director, "POST", `/change-requests/${grade?.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "aprobada", decidedByName: "Directora" });
    const grades = await ctx.call<GradeDto[]>(director, "GET", "/grades");
    expect(grades.body.map((g) => g.name)).toContain("Octavo grado");
    expect((await ctx.call(director, "POST", `/change-requests/${grade?.id}/approve`)).status).toBe(409);
  });

  it("materias, secciones y licencias de maestros también pasan por la dirección", async () => {
    const subject = await ask("materia", { name: "Inglés", language: "en" });
    const section = await ask("seccion", {
      schoolYearId: structure.year.id,
      gradeId: structure.grade.id,
      name: "C",
      capacity: 25,
    });
    expect(section.body.summary).toBe("Crear la sección C de Primer grado, año 2026 (cupo de 25)");
    const leave = await ask("licencia", {
      teacherUserId: ana.id,
      type: "enfermedad",
      startsOn: "2026-11-10",
      endsOn: "2026-11-12",
    });
    expect(leave.body.summary).toMatch(/^Registrar el permiso de Ana Maestra \(enfermedad\) del /);
    for (const r of [subject, section, leave]) {
      const res = await ctx.call(director, "POST", `/change-requests/${r.body.id}/approve`);
      expect(res.status).toBe(200);
    }
    const subjects = await ctx.call<SubjectDto[]>(director, "GET", "/subjects");
    expect(subjects.body.find((s) => s.name === "Inglés")?.language).toBe("en");
    const leaves = await ctx.call<LeaveDto[]>(director, "GET", "/leaves");
    expect(leaves.body.map((l) => l.teacherName)).toContain("Ana Maestra");
  });

  it("si no se puede aplicar, sigue pendiente y la dirección ve por qué; también la puede rechazar", async () => {
    const repeated = await ask("materia", { name: "Inglés" });
    const fail = await ctx.call<{ error: { message: string } }>(
      director,
      "POST",
      `/change-requests/${repeated.body.id}/approve`,
    );
    expect(fail.status).toBe(409);
    expect(fail.body.error.message).toContain("Inglés");
    const rejected = await ctx.call<ChangeRequestDto>(
      director,
      "POST",
      `/change-requests/${repeated.body.id}/reject`,
      { note: "Ya existe" },
    );
    expect(rejected.body).toMatchObject({ status: "rechazada", decisionNote: "Ya existe" });
    const mine = await ctx.call<ChangeRequestDto[]>(secretary, "GET", "/change-requests");
    expect(mine.body.find((r) => r.id === repeated.body.id)?.status).toBe("rechazada");
  });
});
