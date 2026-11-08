import { randomUUID } from "node:crypto";
import type { AssignmentDto, SchoolYearDto, SectionDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let adminA: TestUser;
let adminB: TestUser;
const schoolA = randomUUID();
const schoolB = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic();
  adminA = await ctx.user("admin", schoolA);
  adminB = await ctx.user("admin", schoolB);
});
afterAll(() => ctx.close());

describe("años lectivos", () => {
  it("el primer año queda vigente y solo puede haber uno vigente", async () => {
    const first = await ctx.call<SchoolYearDto>(adminA, "POST", "/school-years", {
      name: "2026",
      startsOn: "2026-02-02",
      endsOn: "2026-11-27",
    });
    expect(first.status).toBe(201);
    expect(first.body.isCurrent).toBe(true);

    const second = await ctx.call<SchoolYearDto>(adminA, "POST", "/school-years", {
      name: "2027",
      startsOn: "2027-02-01",
      endsOn: "2027-11-26",
    });
    expect(second.body.isCurrent).toBe(false);

    await ctx.call(adminA, "POST", `/school-years/${second.body.id}/current`);
    const years = (await ctx.call<SchoolYearDto[]>(adminA, "GET", "/school-years")).body;
    expect(years.filter((y) => y.isCurrent).map((y) => y.name)).toEqual(["2027"]);

    // volver a dejar 2026 como vigente para el resto de pruebas
    await ctx.call(adminA, "POST", `/school-years/${first.body.id}/current`);
  });

  it("valida fechas y nombres repetidos", async () => {
    const backwards = await ctx.call(adminA, "POST", "/school-years", {
      name: "2030",
      startsOn: "2030-11-01",
      endsOn: "2030-02-01",
    });
    expect(backwards.status).toBe(400);
    const dup = await ctx.call(adminA, "POST", "/school-years", {
      name: "2026",
      startsOn: "2026-02-02",
      endsOn: "2026-11-27",
    });
    expect(dup.status).toBe(409);
  });
});

describe("grados, secciones y materias", () => {
  it("crea la estructura y cuenta el cupo", async () => {
    const [year] = (await ctx.call<SchoolYearDto[]>(adminA, "GET", "/school-years")).body.filter(
      (y) => y.isCurrent,
    );
    const grade = (await ctx.call<{ id: string }>(adminA, "POST", "/grades", { name: "Segundo grado" })).body;
    const section = await ctx.call<SectionDto>(adminA, "POST", "/sections", {
      schoolYearId: year?.id,
      gradeId: grade.id,
      name: "A",
      capacity: 25,
    });
    expect(section.status).toBe(201);
    expect(section.body).toMatchObject({ label: "Segundo grado A", capacity: 25, enrolledCount: 0 });

    const dup = await ctx.call(adminA, "POST", "/sections", {
      schoolYearId: year?.id,
      gradeId: grade.id,
      name: "A",
    });
    expect(dup.status).toBe(409);
    expect((await ctx.call(adminA, "POST", "/subjects", { name: "Ciencias Naturales" })).status).toBe(201);
    expect((await ctx.call(adminA, "POST", "/subjects", { name: "Ciencias Naturales" })).status).toBe(409);
  });

  it("un colegio no puede crear secciones con el grado o el año de otro colegio", async () => {
    const gradeA = (await ctx.call<Array<{ id: string }>>(adminA, "GET", "/grades")).body[0];
    const yearB = (
      await ctx.call<{ id: string }>(adminB, "POST", "/school-years", {
        name: "2026",
        startsOn: "2026-02-02",
        endsOn: "2026-11-27",
      })
    ).body;
    const res = await ctx.call(adminB, "POST", "/sections", {
      schoolYearId: yearB.id,
      gradeId: gradeA?.id,
      name: "Z",
    });
    expect(res.status).toBe(404);
    expect((await ctx.call<SectionDto[]>(adminB, "GET", "/sections")).body).toEqual([]);
  });

  it("solo administración y coordinación cambian la estructura", async () => {
    const teacher = await ctx.user("docente", schoolA);
    const secretary = await ctx.user("secretaria", schoolA);
    expect((await ctx.call(teacher, "POST", "/grades", { name: "Tercero" })).status).toBe(403);
    expect((await ctx.call(secretary, "POST", "/grades", { name: "Tercero" })).status).toBe(403);
    expect((await ctx.call(secretary, "GET", "/grades")).status).toBe(200);
    const parent = await ctx.user("padre", schoolA);
    expect((await ctx.call(parent, "GET", "/grades")).status).toBe(403);
  });
});

describe("docentes por materia", () => {
  it("valida al docente contra identity y guarda su nombre", async () => {
    const teacher = await ctx.user("docente", schoolA, "Diego Docente");
    const parent = await ctx.user("padre", schoolA, "Papá");
    const [section] = (await ctx.call<SectionDto[]>(adminA, "GET", "/sections")).body;
    const [subject] = (await ctx.call<Array<{ id: string }>>(adminA, "GET", "/subjects")).body;
    const base = { sectionId: section?.id, subjectId: subject?.id };

    const unknown = await ctx.call(adminA, "POST", "/assignments", { ...base, teacherUserId: randomUUID() });
    expect(unknown.status).toBe(400);
    const notTeacher = await ctx.call(adminA, "POST", "/assignments", { ...base, teacherUserId: parent.id });
    expect(notTeacher.status).toBe(400);

    const ok = await ctx.call<AssignmentDto>(adminA, "POST", "/assignments", {
      ...base,
      teacherUserId: teacher.id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ teacherName: "Diego Docente", sectionLabel: section?.label });

    const again = await ctx.call(adminA, "POST", "/assignments", { ...base, teacherUserId: teacher.id });
    expect(again.status).toBe(409);

    const mine = await ctx.call<AssignmentDto[]>(teacher, "GET", "/me/assignments");
    expect(mine.body.map((a) => a.id)).toEqual([ok.body.id]);
  });

  it("no puede borrar asignaciones de otro colegio", async () => {
    const [assignment] = (await ctx.call<AssignmentDto[]>(adminA, "GET", "/assignments")).body;
    expect((await ctx.call(adminB, "DELETE", `/assignments/${assignment?.id}`)).status).toBe(404);
    expect((await ctx.call(adminA, "DELETE", `/assignments/${assignment?.id}`)).status).toBe(204);
  });
});
