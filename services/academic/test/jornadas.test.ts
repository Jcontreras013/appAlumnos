import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  ScheduleDto,
  SchoolFollowUpDto,
  SectionDto,
  ShiftDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
let weekend: ShiftDto;
let weekendSection: SectionDto;
let weekendClass: AssignmentDto;
let morningClass: AssignmentDto;
let luis: StudentDetailDto;
const schoolId = randomUUID();
const TODAY = "2026-11-09"; // lunes
const SATURDAY = "2026-11-07";

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  structure = await ctx.seedStructure(director);
});
afterAll(() => ctx.close());

describe("jornadas", () => {
  it("la dirección crea la jornada de fin de semana y avisa a identity que hay clases sábado y domingo", async () => {
    expect(
      (await ctx.call(secretary, "POST", "/shifts", { name: "Fin de semana", classDays: [6, 7] })).status,
    ).toBe(403);
    const res = await ctx.call<ShiftDto>(director, "POST", "/shifts", {
      name: "Fin de semana",
      classDays: [7, 6, 6],
    });
    expect(res.status).toBe(201);
    weekend = res.body;
    expect(weekend.classDays).toEqual([6, 7]);
    expect(ctx.weekendNotices.at(-1)).toBe(true);
    const morning = await ctx.call<ShiftDto>(director, "POST", "/shifts", {
      name: "Matutina",
      classDays: [1, 2, 3, 4, 5],
    });
    expect(morning.status).toBe(201);
    const dup = await ctx.call(director, "POST", "/shifts", { name: "Matutina", classDays: [1] });
    expect(dup.status).toBe(409);
  });

  it("una sección nueva en la jornada de fin de semana tiene clases sábado y domingo", async () => {
    const res = await ctx.call<SectionDto>(director, "POST", "/sections", {
      schoolYearId: structure.year.id,
      gradeId: structure.grade.id,
      name: "FS",
      shiftId: weekend.id,
    });
    expect(res.status).toBe(201);
    weekendSection = res.body;
    expect(weekendSection).toMatchObject({ shiftName: "Fin de semana", classDays: [6, 7] });
    // Las de siempre siguen de lunes a viernes.
    const sections = (await ctx.call<SectionDto[]>(director, "GET", "/sections")).body;
    expect(sections.find((s) => s.id === structure.sectionA.id)?.classDays).toEqual([1, 2, 3, 4, 5]);
    const bad = await ctx.call(director, "POST", "/sections", {
      schoolYearId: structure.year.id,
      gradeId: structure.grade.id,
      name: "X",
      shiftId: randomUUID(),
    });
    expect(bad.status).toBe(404);
  });

  it("cada jornada tiene sus horas; el horario solo acepta sus días y cruza docentes por la hora real", async () => {
    weekendClass = (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId: weekendSection.id,
        subjectId: structure.subject.id,
        teacherUserId: ana.id,
      })
    ).body;
    morningClass = (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId: structure.sectionA.id,
        subjectId: structure.subject.id,
        teacherUserId: ana.id,
      })
    ).body;
    expect(weekendClass.classDays).toEqual([6, 7]);

    // Horas de siempre (sin jornada): 7:00 a 8:00. Fin de semana: 8:00 a 11:00.
    await ctx.call(director, "PUT", "/schedule/blocks", { blocks: [{ startsAt: "07:00", endsAt: "08:00" }] });
    const blocks = await ctx.call(director, "PUT", "/schedule/blocks", {
      shiftId: weekend.id,
      blocks: [{ startsAt: "08:00", endsAt: "11:00" }],
    });
    expect(blocks.status).toBe(200);
    expect((await ctx.call(director, "GET", `/schedule/blocks?shiftId=${weekend.id}`)).body).toEqual([
      { number: 1, startsAt: "08:00", endsAt: "11:00" },
    ]);

    const monday = await ctx.call(director, "PUT", `/schedule/sections/${weekendSection.id}`, {
      slots: [{ weekday: 1, block: 1, assignmentId: weekendClass.id }],
    });
    expect(monday.status).toBe(400);
    const saturday = await ctx.call<ScheduleDto>(director, "PUT", `/schedule/sections/${weekendSection.id}`, {
      slots: [{ weekday: 6, block: 1, assignmentId: weekendClass.id }],
    });
    expect(saturday.status).toBe(200);
    expect(saturday.body.classDays).toEqual([6, 7]);
    expect(saturday.body.blocks).toEqual([{ number: 1, startsAt: "08:00", endsAt: "11:00" }]);

    // Lunes a las 7:00 en la matutina no choca con nada (la 1.ª hora del sábado es otro día).
    const morningSlot = await ctx.call(director, "PUT", `/schedule/sections/${structure.sectionA.id}`, {
      slots: [{ weekday: 1, block: 1, assignmentId: morningClass.id }],
    });
    expect(morningSlot.status).toBe(200);

    // El horario de Ana: un horario por jornada, cada uno con sus horas.
    const mine = (await ctx.call<ScheduleDto>(ana, "GET", "/schedule/mine")).body;
    expect(mine.shifts?.map((g) => [g.shiftName, g.classDays, g.slots.length])).toEqual(
      expect.arrayContaining([
        [null, [1, 2, 3, 4, 5], 1],
        ["Fin de semana", [6, 7], 1],
      ]),
    );
  });

  it("quitar el domingo a la jornada quita sus clases de ese día; no se borra si tiene secciones", async () => {
    await ctx.call(director, "PUT", `/schedule/sections/${weekendSection.id}`, {
      slots: [
        { weekday: 6, block: 1, assignmentId: weekendClass.id },
        { weekday: 7, block: 1, assignmentId: weekendClass.id },
      ],
    });
    const res = await ctx.call<ShiftDto>(director, "PUT", `/shifts/${weekend.id}`, {
      name: "Sabatina",
      classDays: [6],
    });
    expect(res.status).toBe(200);
    const schedule = (await ctx.call<ScheduleDto>(director, "GET", `/schedule/sections/${weekendSection.id}`))
      .body;
    expect(schedule.slots.map((s) => s.weekday)).toEqual([6]);
    expect((await ctx.call(director, "DELETE", `/shifts/${weekend.id}`)).status).toBe(409);
    // Vuelve a ser de sábado y domingo para lo que sigue.
    await ctx.call(director, "PUT", `/shifts/${weekend.id}`, { name: "Fin de semana", classDays: [6, 7] });
  });

  it("en fin de semana la alerta de inasistencia salta desde la primera falta", async () => {
    luis = (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames: "Luis",
        lastNames: "López",
        guardians: [guardian()],
        sectionId: weekendSection.id,
      })
    ).body;
    const mario = (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames: "Mario",
        lastNames: "Paz",
        guardians: [guardian({ fullName: "Rosa Paz" })],
        sectionId: structure.sectionA.id,
      })
    ).body;
    const take = await ctx.call(director, "PUT", "/attendance", {
      sectionId: weekendSection.id,
      date: SATURDAY,
      entries: [{ studentId: luis.id, status: "ausente" }],
    });
    expect(take.status).toBe(200);
    await ctx.call(director, "PUT", "/attendance", {
      sectionId: structure.sectionA.id,
      date: "2026-11-06",
      entries: [{ studentId: mario.id, status: "ausente" }],
    });
    const board = (await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up")).body;
    const atRisk = board.studentsAtRisk.map((s) => s.studentId);
    expect(atRisk).toContain(luis.id);
    expect(atRisk).not.toContain(mario.id); // entre semana hacen falta más ausencias
  });

  it("sin jornadas de fin de semana, identity deja de avisar sábado y domingo", async () => {
    await ctx.call(director, "PUT", `/sections/${weekendSection.id}`, {
      name: "FS",
      capacity: null,
      shiftId: null,
    });
    expect((await ctx.call(director, "DELETE", `/shifts/${weekend.id}`)).status).toBe(204);
    expect(ctx.weekendNotices.at(-1)).toBe(false);
    const section = (await ctx.call<SectionDto[]>(director, "GET", "/sections")).body.find(
      (s) => s.id === weekendSection.id,
    );
    expect(section).toMatchObject({ shiftId: null, classDays: [1, 2, 3, 4, 5] });
  });
});
