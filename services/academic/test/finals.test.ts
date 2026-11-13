import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  GradingPeriodDto,
  PromotionSummaryDto,
  SectionDto,
  SectionFinalsDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/**
 * Fin de año en Primer grado A: Ana aprueba, Beto aprueba en recuperación, Ceci repite y a Dani le
 * falta un parcial. Luego todos pasan al año 2027.
 */

let ctx: AcademicTestContext;
let director: TestUser;
let teacher: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
let math: AssignmentDto;
const ids: Record<string, string> = {};
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-25" });
  director = await ctx.user("admin", schoolId, "Directora");
  teacher = await ctx.user("docente", schoolId, "Ana Maestra");
  structure = await ctx.seedStructure(director);
  math = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: structure.sectionA.id,
      subjectId: structure.subject.id,
      teacherUserId: teacher.id,
    })
  ).body;
  for (const name of ["Ana", "Beto", "Ceci", "Dani"]) {
    ids[name] = (
      await ctx.call<StudentDetailDto>(director, "POST", "/students", {
        firstNames: name,
        lastNames: "Alumno",
        guardians: [guardian({ fullName: `Familia de ${name}` })],
        sectionId: structure.sectionA.id,
      })
    ).body.id;
  }
  const { periods } = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body;
  const points: Record<string, number> = { Ana: 80, Beto: 60, Ceci: 60, Dani: 90 };
  for (const [i, period] of periods.entries()) {
    const id = randomUUID();
    await ctx.call(director, "PUT", `/activities/${id}`, {
      id,
      assignmentId: math.id,
      periodId: period.id,
      name: `Examen ${i + 1}`,
      maxPoints: 100,
      date: period.startsOn,
    });
    await ctx.call(director, "PUT", "/scores", {
      activityId: id,
      entries: Object.entries(points)
        // A Dani le falta la nota del último parcial.
        .map(([name, value]) => ({
          studentId: ids[name],
          points: name === "Dani" && i === 3 ? null : value,
        })),
    });
  }
});
afterAll(() => ctx.close());

const finals = async (who = director) =>
  (await ctx.call<SectionFinalsDto>(who, "GET", `/sections/${structure.sectionA.id}/finals`)).body;
const of = (f: SectionFinalsDto, name: string) => f.students.find((s) => s.name === `Alumno, ${name}`);

describe("notas finales", () => {
  it("promedio de los parciales, resultado de la materia y propuesta para el año siguiente", async () => {
    const f = await finals();
    expect(f.periods).toHaveLength(4);
    expect(of(f, "Ana")).toMatchObject({
      proposal: "promovido",
      subjects: [{ average: 80, status: "aprobada" }],
    });
    expect(of(f, "Beto")).toMatchObject({
      proposal: "repite",
      subjects: [{ average: 60, status: "reprobada" }],
    });
    // Sin nota en un parcial, ese parcial no está completo (los 100 puntos repartidos cuentan el cero).
    expect(of(f, "Dani")?.subjects[0]?.periods).toEqual([90, 90, 90, 0]);
  });

  it("la docente de la clase registra la recuperación; solo para quien no alcanzó la nota", async () => {
    const put = (who: TestUser, entries: object[]) =>
      ctx.call<SectionFinalsDto>(who, "PUT", `/assignments/${math.id}/recoveries`, { entries });
    expect((await put(teacher, [{ studentId: ids.Ana, score: 90 }])).status).toBe(400);
    const res = await put(teacher, [{ studentId: ids.Beto, score: 75 }]);
    expect(res.status).toBe(200);
    expect(of(res.body, "Beto")).toMatchObject({
      proposal: "promovido",
      subjects: [{ average: 60, recovery: 75, status: "aprobada_recuperacion" }],
    });
    const other = await ctx.user("docente", schoolId);
    expect((await put(other, [{ studentId: ids.Ceci, score: 80 }])).status).toBe(404);
    expect((await ctx.call(other, "GET", `/sections/${structure.sectionA.id}/finals`)).status).toBe(404);
    expect(of(await finals(teacher), "Ceci")?.proposal).toBe("repite");
  });
});

describe("paso al año siguiente", () => {
  let year2027: string;
  let primerA2027: SectionDto;
  let segundoA2027: SectionDto;
  const promote = (body: object) => ctx.call<PromotionSummaryDto>(director, "POST", "/promotion", body);

  beforeAll(async () => {
    year2027 = (
      await ctx.call<{ id: string }>(director, "POST", "/school-years", {
        name: "2027",
        startsOn: "2027-02-01",
        endsOn: "2027-11-26",
      })
    ).body.id;
    const segundo = (
      await ctx.call<{ id: string }>(director, "POST", "/grades", { name: "Segundo grado", sortOrder: 2 })
    ).body;
    const section = (gradeId: string) =>
      ctx.call<SectionDto>(director, "POST", "/sections", { schoolYearId: year2027, gradeId, name: "A" });
    primerA2027 = (await section(structure.grade.id)).body;
    segundoA2027 = (await section(segundo.id)).body;
  });

  const plan = (dryRun: boolean, overrides: object[] = []) =>
    promote({
      toSchoolYearId: year2027,
      dryRun,
      sections: [
        {
          fromSectionId: structure.sectionA.id,
          promotedToSectionId: segundoA2027.id,
          repeatToSectionId: primerA2027.id,
        },
      ],
      overrides,
    });

  it("la revisión muestra a dónde va cada uno y qué falta decidir", async () => {
    const res = await plan(true);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.rows.map((r) => [r.name, r]));
    expect(byName["Alumno, Ana"]).toMatchObject({ decision: "promovido", toSectionLabel: "Segundo grado A" });
    expect(byName["Alumno, Beto"]).toMatchObject({
      decision: "promovido",
      toSectionLabel: "Segundo grado A",
    });
    expect(byName["Alumno, Ceci"]).toMatchObject({ decision: "repite", toSectionLabel: "Primer grado A" });
    expect(res.body.enrolled).toBe(0);
  });

  it("la dirección decide sobre la propuesta y al confirmar quedan matriculados en 2027", async () => {
    const res = await plan(false, [{ studentId: ids.Ceci, decision: "promovido" }]);
    expect(res.body.enrolled).toBe(4);
    expect(res.body.rows.every((r) => r.problem === null)).toBe(true);
    const ceci = (await ctx.call<StudentDetailDto>(director, "GET", `/students/${ids.Ceci}`)).body;
    expect(ceci.enrollments.map((e) => `${e.schoolYearName} ${e.sectionLabel}`)).toContain(
      "2027 Segundo grado A",
    );
    const again = await plan(true);
    expect(again.body.rows.every((r) => r.problem === "Ya está matriculado en el año siguiente")).toBe(true);
  });

  it("sin sección de destino, los del último grado egresan; y solo la dirección lo hace", async () => {
    const res = await promote({
      toSchoolYearId: year2027,
      dryRun: true,
      sections: [
        { fromSectionId: structure.sectionB.id, promotedToSectionId: null, repeatToSectionId: null },
      ],
    });
    expect(res.body.rows).toEqual([]);
    expect(
      (await ctx.call(teacher, "POST", "/promotion", { toSchoolYearId: year2027, sections: [] })).status,
    ).toBe(403);
    const current = (
      await ctx.call<Array<{ id: string; isCurrent: boolean }>>(director, "GET", "/school-years")
    ).body.find((y) => y.isCurrent);
    expect(
      (
        await promote({
          toSchoolYearId: current?.id,
          sections: [
            { fromSectionId: structure.sectionA.id, promotedToSectionId: null, repeatToSectionId: null },
          ],
        })
      ).status,
    ).toBe(400);
  });
});
