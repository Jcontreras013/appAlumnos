import { randomUUID } from "node:crypto";
import type { AssignmentDto, RegionalOverviewDto, RegionalSchoolDetailDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic } from "./helpers";

let ctx: AcademicTestContext;
const schoolA = { id: randomUUID(), name: "Escuela Coxen Hole", districtName: "Roatán" };
const schoolB = { id: randomUUID(), name: "Escuela Utila", districtName: "Utila" };
const outside = { id: randomUUID(), name: "Escuela de otro departamento" };

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
  for (const [school, students, onLeave] of [
    [schoolA, 3, true],
    [schoolB, 2, false],
    [outside, 5, true],
  ] as const) {
    const director = await ctx.user("admin", school.id);
    const teacher = await ctx.user("docente", school.id);
    const s = await ctx.seedStructure(director);
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: s.sectionA.id,
      subjectId: s.subject.id,
      teacherUserId: teacher.id,
    });
    for (let i = 0; i < students; i++) {
      await ctx.call(director, "POST", "/students", {
        firstNames: `Alumno ${i}`,
        lastNames: school.name,
        guardians: [guardian()],
        sectionId: s.sectionB.id,
      });
    }
    if (onLeave) {
      await ctx.call(director, "POST", "/leaves", {
        teacherUserId: teacher.id,
        type: "enfermedad",
        startsOn: "2026-11-09",
        endsOn: "2026-11-12",
      });
    }
  }
});
afterAll(() => ctx.close());

describe("tablero departamental", () => {
  it("resume solo los centros del ámbito que indica identity", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [schoolA, schoolB]);
    const res = await ctx.call<RegionalOverviewDto>(departmental, "GET", "/regional/overview");
    expect(res.status).toBe(200);
    expect(res.body.schools.map((s) => s.schoolName).sort()).toEqual(["Escuela Coxen Hole", "Escuela Utila"]);
    expect(res.body.schools.find((s) => s.schoolId === schoolA.id)).toMatchObject({
      students: 3,
      sections: 2,
      teachers: 1,
      classes: 1,
      teachersOnLeave: 1,
      uncoveredClasses: 1,
      schoolYear: "2026",
      districtName: "Roatán",
    });
    expect(res.body.totals).toMatchObject({
      schools: 2,
      students: 5,
      uncoveredClasses: 1,
      schoolsWithUncoveredClasses: 1,
    });
  });

  it("un día después de la licencia ya no hay clases sin maestro", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [schoolA, schoolB]);
    const res = await ctx.call<RegionalOverviewDto>(
      departmental,
      "GET",
      "/regional/overview?fecha=2026-11-13",
    );
    expect(res.body.totals.uncoveredClasses).toBe(0);
  });

  it("la distrital ve solo su distrito y no entra a centros fuera de su ámbito", async () => {
    const distrital = await ctx.regionalUser("director_distrital", [schoolB]);
    const res = await ctx.call<RegionalOverviewDto>(distrital, "GET", "/regional/overview");
    expect(res.body.schools.map((s) => s.schoolName)).toEqual(["Escuela Utila"]);
    expect((await ctx.call(distrital, "GET", `/regional/schools/${schoolA.id}`)).status).toBe(404);
  });

  it("el detalle de un centro muestra qué clases están sin maestro", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [schoolA, schoolB]);
    const res = await ctx.call<RegionalSchoolDetailDto>(
      departmental,
      "GET",
      `/regional/schools/${schoolA.id}`,
    );
    expect(res.body.coverage.rows.map((r) => r.status)).toEqual(["sin_cubrir"]);
    expect(res.body.sections.map((s) => s.enrolledCount)).toEqual([0, 3]);
  });

  it("las direcciones de centro no usan el tablero regional", async () => {
    const director = await ctx.user("admin", schoolA.id);
    expect((await ctx.call(director, "GET", "/regional/overview")).status).toBe(403);
  });
});
