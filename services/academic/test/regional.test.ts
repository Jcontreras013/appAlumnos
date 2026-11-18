import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  AuditEventDto,
  RegionalOverviewDto,
  RegionalSchoolDetailDto,
  RegionalStudentDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

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

describe("detalle de los indicadores de un centro y ficha de un alumno", () => {
  const oakRidge = { id: randomUUID(), name: "Escuela Oak Ridge", districtName: "Roatán" };
  const punta = { id: randomUUID(), name: "Escuela Punta Gorda", districtName: "Roatán" };
  let director: TestUser;
  let sectionId: string;
  let studentId: string;
  let otherStudentId: string;

  beforeAll(async () => {
    director = await ctx.user("admin", oakRidge.id, "Directora Oak Ridge");
    const teacher = await ctx.user("docente", oakRidge.id);
    const s = await ctx.seedStructure(director);
    sectionId = s.sectionA.id;
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId,
      subjectId: s.subject.id,
      teacherUserId: teacher.id,
    });
    studentId = (
      await ctx.call<StudentDetailDto>(director, "POST", "/students", {
        firstNames: "Luis",
        lastNames: "Ebanks",
        guardians: [guardian()],
        sectionId,
      })
    ).body.id;
    // Cinco ausencias en la última semana: queda en riesgo por faltas.
    for (const date of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"]) {
      await ctx.call(director, "PUT", "/attendance", {
        sectionId,
        date,
        entries: [{ studentId, status: "ausente" }],
      });
    }
    await ctx.call(director, "POST", `/students/${studentId}/follow-ups`, {
      kind: "llamada",
      date: "2026-11-06",
      notes: "Se llamó a la madre; se acordó que vuelve el lunes",
    });

    const otherDirector = await ctx.user("admin", punta.id);
    const other = await ctx.seedStructure(otherDirector);
    otherStudentId = (
      await ctx.call<StudentDetailDto>(otherDirector, "POST", "/students", {
        firstNames: "Ana",
        lastNames: "Bodden",
        guardians: [guardian()],
        sectionId: other.sectionA.id,
      })
    ).body.id;
  });

  it("el detalle de un centro trae quiénes están detrás de cada indicador", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [oakRidge, punta]);
    const res = await ctx.call<RegionalSchoolDetailDto>(
      departmental,
      "GET",
      `/regional/schools/${oakRidge.id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.summary.studentsAtRisk).toBe(1);
    expect(res.body.studentsAtRisk).toMatchObject([{ studentId, absences: 5, followUps: 1 }]);
    expect(res.body.gradeProgress).toHaveLength(1);
    expect(res.body.plans.map((p) => p.status)).toEqual(["sin_iniciar"]);
    expect(res.body.attendanceBySection.find((a) => a.sectionId === sectionId)).toMatchObject({
      rate: 0,
      recordedDays: 5,
    });
  });

  it("la departamental abre la ficha del alumno en riesgo y la consulta queda en la bitácora", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [oakRidge, punta]);
    const res = await ctx.call<RegionalStudentDto>(
      departmental,
      "GET",
      `/regional/schools/${oakRidge.id}/students/${studentId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.school.name).toBe("Escuela Oak Ridge");
    expect(res.body.child.student.name).toContain("Luis");
    expect(res.body.risk).toMatchObject({ studentId, absences: 5 });
    expect(res.body.followUps).toMatchObject([
      { kind: "llamada", notes: "Se llamó a la madre; se acordó que vuelve el lunes" },
    ]);
    const log = await ctx.call<AuditEventDto[]>(director, "GET", "/audit?limite=10");
    expect(log.body.some((e) => e.action === "student.viewed_by_region" && e.entityId === studentId)).toBe(
      true,
    );
  });

  it("no abre alumnos fuera del ámbito ni alumnos de otro centro por la dirección de este", async () => {
    const distrital = await ctx.regionalUser("director_distrital", [schoolB]);
    expect(
      (await ctx.call(distrital, "GET", `/regional/schools/${oakRidge.id}/students/${studentId}`)).status,
    ).toBe(404);
    const departmental = await ctx.regionalUser("director_departamental", [oakRidge, punta]);
    expect(
      (await ctx.call(departmental, "GET", `/regional/schools/${oakRidge.id}/students/${otherStudentId}`))
        .status,
    ).toBe(404);
    expect(
      (await ctx.call(director, "GET", `/regional/schools/${oakRidge.id}/students/${studentId}`)).status,
    ).toBe(403);
  });
});
