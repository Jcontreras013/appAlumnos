import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  EnrollmentSettingsDto,
  StudentDetailDto,
  StudentListItemDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser; // da clase en 1A
let beto: TestUser; // da clase en 1B
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

const newStudent = (overrides: Record<string, unknown> = {}) => ({
  firstNames: "Carla",
  lastNames: "Mejía Ruiz",
  guardians: [guardian({ fullName: "Rosa Ruiz" })],
  ...overrides,
});

beforeAll(async () => {
  ctx = await setupAcademic();
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  beto = await ctx.user("docente", schoolId, "Beto Maestro");
  structure = await ctx.seedStructure(director);
  for (const [teacher, section] of [
    [ana, structure.sectionA],
    [beto, structure.sectionB],
  ] as const) {
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: section.id,
      subjectId: structure.subject.id,
      teacherUserId: teacher.id,
    });
  }
});
afterAll(() => ctx.close());

describe("matrícula por los maestros", () => {
  it("viene desactivada: el maestro no puede matricular ni ver la lista", async () => {
    const settings = await ctx.call<EnrollmentSettingsDto>(ana, "GET", "/enrollment-settings");
    expect(settings.body).toEqual({ teachersEnroll: false, mySectionIds: [] });
    expect((await ctx.call(ana, "GET", "/students")).status).toBe(403);
    const res = await ctx.call(ana, "POST", "/students", newStudent({ sectionId: structure.sectionA.id }));
    expect(res.status).toBe(403);
  });

  it("solo la dirección la activa", async () => {
    const body = { teachersEnroll: true };
    expect((await ctx.call(secretary, "PUT", "/enrollment-settings", body)).status).toBe(403);
    expect((await ctx.call(ana, "PUT", "/enrollment-settings", body)).status).toBe(403);
    const res = await ctx.call<EnrollmentSettingsDto>(director, "PUT", "/enrollment-settings", body);
    expect(res.body.teachersEnroll).toBe(true);
    const mine = await ctx.call<EnrollmentSettingsDto>(ana, "GET", "/enrollment-settings");
    expect(mine.body).toEqual({ teachersEnroll: true, mySectionIds: [structure.sectionA.id] });
  });

  it("activada, el maestro registra y matricula alumnos solo en sus secciones", async () => {
    const ok = await ctx.call<StudentDetailDto>(
      ana,
      "POST",
      "/students",
      newStudent({ sectionId: structure.sectionA.id }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.enrollments).toMatchObject([{ sectionLabel: "Primer grado A", status: "activa" }]);
    const otherSection = await ctx.call(
      ana,
      "POST",
      "/students",
      newStudent({ firstNames: "Otro", sectionId: structure.sectionB.id }),
    );
    expect(otherSection.status).toBe(403);
    // Sin sección no: el maestro siempre matricula al registrar.
    expect((await ctx.call(ana, "POST", "/students", newStudent({ firstNames: "Sin" }))).status).toBe(403);
  });

  it("matricula a un alumno ya registrado sin matrícula; no toca a los de otras secciones", async () => {
    const pending = (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", newStudent({ firstNames: "Pedro" }))
    ).body;
    const inB = (
      await ctx.call<StudentDetailDto>(
        secretary,
        "POST",
        "/students",
        newStudent({ firstNames: "Lucía", sectionId: structure.sectionB.id }),
      )
    ).body;

    const list = await ctx.call<{ items: StudentListItemDto[] }>(ana, "GET", "/students");
    const names = list.body.items.map((s) => s.firstNames);
    expect(names).toContain("Pedro"); // sin matrícula: lo puede matricular
    expect(names).toContain("Carla"); // de su sección
    expect(names).not.toContain("Lucía"); // de otra sección

    expect((await ctx.call(ana, "GET", `/students/${inB.id}`)).status).toBe(403);
    expect(
      (await ctx.call(ana, "PUT", `/students/${inB.id}`, { firstNames: "X", lastNames: "Y" })).status,
    ).toBe(403);
    expect(
      (await ctx.call(ana, "POST", "/enrollments", { studentId: inB.id, sectionId: structure.sectionA.id }))
        .status,
    ).toBe(403);

    const enrolled = await ctx.call<StudentDetailDto>(ana, "POST", "/enrollments", {
      studentId: pending.id,
      sectionId: structure.sectionA.id,
    });
    expect(enrolled.status).toBe(201);
  });

  it("retiros y traslados siguen en la secretaría", async () => {
    const list = await ctx.call<{ items: StudentListItemDto[] }>(ana, "GET", "/students?estado=matriculados");
    const enrollmentId = list.body.items[0]?.enrollment?.id;
    expect(enrollmentId).toBeDefined();
    const withdraw = await ctx.call(ana, "POST", `/enrollments/${enrollmentId}/withdraw`, {
      withdrawnOn: "2026-11-09",
      reason: "Cambio de domicilio",
    });
    expect(withdraw.status).toBe(403);
  });

  it("al desactivarla, el maestro deja de poder matricular", async () => {
    await ctx.call(director, "PUT", "/enrollment-settings", { teachersEnroll: false });
    const res = await ctx.call(ana, "POST", "/students", newStudent({ sectionId: structure.sectionA.id }));
    expect(res.status).toBe(403);
    expect(beto.id).toBeDefined();
  });
});
