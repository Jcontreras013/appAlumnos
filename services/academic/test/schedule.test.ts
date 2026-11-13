import { randomUUID } from "node:crypto";
import type { AssignmentDto, PortalAccessDto, ScheduleDto, StudentDetailDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Horario de clases: horas del centro, horario por sección sin cruces y vistas de docente y familia. */

let ctx: AcademicTestContext;
let director: TestUser;
let ana: TestUser;
let beto: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
let mathA: AssignmentDto;
let mathB: AssignmentDto;
let spanishA: AssignmentDto;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic();
  director = await ctx.user("admin", schoolId, "Directora");
  ana = await ctx.user("docente", schoolId, "Ana");
  beto = await ctx.user("docente", schoolId, "Beto");
  structure = await ctx.seedStructure(director);
  const spanish = (await ctx.call<{ id: string }>(director, "POST", "/subjects", { name: "Español" })).body;
  const assign = async (sectionId: string, subjectId: string, teacher: TestUser) =>
    (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId,
        subjectId,
        teacherUserId: teacher.id,
      })
    ).body;
  mathA = await assign(structure.sectionA.id, structure.subject.id, ana);
  mathB = await assign(structure.sectionB.id, structure.subject.id, ana);
  spanishA = await assign(structure.sectionA.id, spanish.id, beto);
});
afterAll(() => ctx.close());

const blocks = [
  { startsAt: "07:00", endsAt: "07:45" },
  { startsAt: "07:45", endsAt: "08:30" },
  { startsAt: "08:45", endsAt: "09:30" },
];
const putSchedule = (sectionId: string, slots: object[]) =>
  ctx.call<ScheduleDto & { error?: { message: string } }>(
    director,
    "PUT",
    `/schedule/sections/${sectionId}`,
    {
      slots,
    },
  );

describe("horas de clase del centro", () => {
  it("se guardan en orden y no pueden encimarse", async () => {
    const ok = await ctx.call<ScheduleDto["blocks"]>(director, "PUT", "/schedule/blocks", { blocks });
    expect(ok.body.map((b) => b.number)).toEqual([1, 2, 3]);
    const overlapped = await ctx.call(director, "PUT", "/schedule/blocks", {
      blocks: [
        { startsAt: "07:00", endsAt: "08:00" },
        { startsAt: "07:30", endsAt: "08:30" },
      ],
    });
    expect(overlapped.status).toBe(400);
    expect((await ctx.call(ana, "PUT", "/schedule/blocks", { blocks })).status).toBe(403);
  });
});

describe("horario por sección", () => {
  it("se arma la semana de la sección A", async () => {
    const res = await putSchedule(structure.sectionA.id, [
      { weekday: 1, block: 1, assignmentId: mathA.id },
      { weekday: 1, block: 2, assignmentId: spanishA.id },
      { weekday: 3, block: 1, assignmentId: mathA.id },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.slots.map((s) => `${s.weekday}-${s.block}-${s.subjectName}`)).toEqual([
      "1-1-Matemáticas",
      "1-2-Español",
      "3-1-Matemáticas",
    ]);
  });

  it("no deja poner a un docente en dos secciones a la misma hora", async () => {
    const clash = await putSchedule(structure.sectionB.id, [
      { weekday: 1, block: 1, assignmentId: mathB.id },
    ]);
    expect(clash.status).toBe(409);
    expect(clash.body.error?.message).toContain("Lunes, 1.ª hora: Ana ya da clase en Primer grado A");
    const ok = await putSchedule(structure.sectionB.id, [{ weekday: 1, block: 3, assignmentId: mathB.id }]);
    expect(ok.status).toBe(200);
  });

  it("valida horas, repetidos y clases de otra sección", async () => {
    expect(
      (await putSchedule(structure.sectionA.id, [{ weekday: 2, block: 7, assignmentId: mathA.id }])).status,
    ).toBe(400);
    expect(
      (
        await putSchedule(structure.sectionA.id, [
          { weekday: 2, block: 1, assignmentId: mathA.id },
          { weekday: 2, block: 1, assignmentId: spanishA.id },
        ])
      ).status,
    ).toBe(400);
    expect(
      (await putSchedule(structure.sectionA.id, [{ weekday: 2, block: 1, assignmentId: mathB.id }])).status,
    ).toBe(400);
  });

  it("si el centro quita horas, las clases de esas horas salen del horario", async () => {
    await ctx.call(director, "PUT", "/schedule/blocks", { blocks: blocks.slice(0, 2) });
    const b = (await ctx.call<ScheduleDto>(director, "GET", `/schedule/sections/${structure.sectionB.id}`))
      .body;
    expect(b.slots).toEqual([]);
    await ctx.call(director, "PUT", "/schedule/blocks", { blocks });
  });
});

describe("cada quien ve su horario", () => {
  it("la docente ve sus horas en todas sus secciones", async () => {
    await putSchedule(structure.sectionB.id, [{ weekday: 2, block: 1, assignmentId: mathB.id }]);
    const mine = (await ctx.call<ScheduleDto>(ana, "GET", "/schedule/mine")).body;
    expect(mine.slots.map((s) => `${s.weekday}-${s.block}-${s.sectionLabel}`)).toEqual([
      "1-1-Primer grado A",
      "2-1-Primer grado B",
      "3-1-Primer grado A",
    ]);
  });

  it("la familia ve el de la sección de su hijo, y no el de otros alumnos", async () => {
    const kid = (
      await ctx.call<StudentDetailDto>(director, "POST", "/students", {
        firstNames: "Luis",
        lastNames: "Alumno",
        guardians: [guardian({ nationalId: "0801198000001" })],
        sectionId: structure.sectionA.id,
      })
    ).body;
    const access = await ctx.call<PortalAccessDto>(
      director,
      "POST",
      `/guardians/${kid.guardians[0]?.id}/portal-access`,
      {},
    );
    const mom = await ctx.user("padre", schoolId, "Mamá", access.body.userId);
    const schedule = (await ctx.call<ScheduleDto>(mom, "GET", `/family/children/${kid.id}/schedule`)).body;
    expect(schedule.blocks).toHaveLength(3);
    expect(schedule.slots).toHaveLength(3);
    expect((await ctx.call(mom, "GET", `/family/children/${randomUUID()}/schedule`)).status).toBe(404);
  });
});
