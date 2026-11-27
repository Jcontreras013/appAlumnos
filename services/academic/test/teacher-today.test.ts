import { randomUUID } from "node:crypto";
import type { AssignmentDto, StudentDetailDto, TeacherTodayDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let ana: TestUser;
let math: AssignmentDto;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-10" }); // martes
  director = await ctx.user("admin", schoolId, "Directora");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  structure = await ctx.seedStructure(director);
  math = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: structure.sectionA.id,
      subjectId: structure.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  await ctx.call<StudentDetailDto>(director, "POST", "/students", {
    firstNames: "Luis",
    lastNames: "López",
    guardians: [guardian()],
    sectionId: structure.sectionA.id,
  });
});
afterAll(() => ctx.close());

describe("el día del maestro", () => {
  it("sin horario: la clase sale hoy (día de clase) sin hora y con la asistencia pendiente", async () => {
    const res = await ctx.call<TeacherTodayDto>(ana, "GET", "/teacher/today");
    expect(res.status).toBe(200);
    expect(res.body.classes).toEqual([
      expect.objectContaining({ assignmentId: math.id, startsAt: null, attendanceTaken: false }),
    ]);
  });

  it("con horario: solo los días que la tiene, con su hora; y se marca la asistencia ya pasada", async () => {
    await ctx.call(director, "PUT", "/schedule/blocks", { blocks: [{ startsAt: "08:00", endsAt: "08:45" }] });
    await ctx.call(director, "PUT", `/schedule/sections/${structure.sectionA.id}`, {
      slots: [{ weekday: 2, block: 1, assignmentId: math.id }],
    });
    let res = await ctx.call<TeacherTodayDto>(ana, "GET", "/teacher/today");
    expect(res.body.classes[0]).toMatchObject({ startsAt: "08:00", endsAt: "08:45" });
    const roster = await ctx.call<{ students: Array<{ studentId: string }> }>(
      ana,
      "GET",
      `/attendance/${structure.sectionA.id}`,
    );
    await ctx.call(ana, "PUT", "/attendance", {
      sectionId: structure.sectionA.id,
      date: "2026-11-10",
      entries: roster.body.students.map((s) => ({ studentId: s.studentId, status: "presente" })),
    });
    res = await ctx.call<TeacherTodayDto>(ana, "GET", "/teacher/today");
    expect(res.body.classes[0]?.attendanceTaken).toBe(true);
    // El miércoles no la tiene.
    ctx.setToday("2026-11-11");
    res = await ctx.call<TeacherTodayDto>(ana, "GET", "/teacher/today");
    expect(res.body.classes).toEqual([]);
  });
});
