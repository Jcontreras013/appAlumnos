import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  FamilyChildDto,
  FamilyChildSummaryDto,
  GradingPeriodDto,
  PlanDetailDto,
  PortalAccessDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser; // maestra de Matemáticas 1A
let math1A: AssignmentDto;
let luis: StudentDetailDto;
let sofia: StudentDetailDto; // hermana de Luis (misma madre)
let pedro: StudentDetailDto; // otra familia
let periods: GradingPeriodDto[];
const schoolId = randomUUID();
const TODAY = "2026-11-09";
const MOM = "0801198501234";

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  const s = await ctx.seedStructure(director);
  math1A = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: s.sectionA.id,
      subjectId: s.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  const create = async (firstNames: string, g: Record<string, unknown>) =>
    (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames,
        lastNames: "López",
        guardians: [guardian(g)],
        sectionId: s.sectionA.id,
      })
    ).body;
  luis = await create("Luis", { nationalId: MOM });
  sofia = await create("Sofía", { nationalId: MOM });
  pedro = await create("Pedro", { fullName: "Carlos Pérez", phone: "9911-2233" });
  periods = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body.periods;

  // Notas del IV parcial: Luis lleva 18/20 y 25/30.
  const current = periods[3] as GradingPeriodDto;
  for (const [name, maxPoints, points] of [
    ["Tarea 1", 20, 18],
    ["Prueba", 30, 25],
  ] as const) {
    const id = randomUUID();
    await ctx.call(ana, "PUT", `/activities/${id}`, {
      id,
      assignmentId: math1A.id,
      periodId: current.id,
      name,
      maxPoints,
      date: TODAY,
    });
    await ctx.call(ana, "PUT", "/scores", { activityId: id, entries: [{ studentId: luis.id, points }] });
  }
  // Asistencia: una ausencia y una llegada tarde.
  for (const [date, status] of [
    ["2026-11-03", "ausente"],
    ["2026-11-04", "tarde"],
    ["2026-11-05", "presente"],
  ] as const) {
    await ctx.call(ana, "PUT", "/attendance", {
      sectionId: s.sectionA.id,
      date,
      entries: [
        { studentId: luis.id, status },
        { studentId: sofia.id, status: "presente" },
        { studentId: pedro.id, status: "presente" },
      ],
    });
  }
  // Planificación de esta semana con tarea para la casa.
  const plan = await ctx.call<PlanDetailDto>(ana, "POST", "/plans", { assignmentId: math1A.id, weekStart: TODAY });
  await ctx.call(ana, "POST", `/plans/${plan.body.plan.id}/submit`, {
    content: {
      tema: "Fracciones equivalentes",
      estandar: "Reconoce fracciones equivalentes",
      contenidos: "Fracciones",
      actividades: { lunes: "Repaso", martes: "", miercoles: "", jueves: "", viernes: "" },
      evaluacion: "Prueba corta",
      tareas: "Página 45, ejercicios 1 al 10",
    },
  });
});
afterAll(() => ctx.close());

const motherId = () => luis.guardians[0]?.id as string;

describe("acceso al portal", () => {
  let access: PortalAccessDto;

  it("la secretaría da acceso a la madre: entra con su identidad y ve a sus dos hijos", async () => {
    const res = await ctx.call<PortalAccessDto>(secretary, "POST", `/guardians/${motherId()}/portal-access`, {});
    expect(res.status).toBe(200);
    access = res.body;
    expect(access).toMatchObject({ login: MOM, linkedExisting: false, guardianName: "María López Castro" });
    expect(access.temporaryPassword).toBeTruthy();
    expect(access.children.sort()).toEqual(["Luis López", "Sofía López"]);
    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${luis.id}`);
    expect(detail.body.guardians[0]?.hasPortalAccess).toBe(true);
  });

  it("si el encargado no tiene identidad ni correo, hay que escribir uno (y queda en su ficha)", async () => {
    const dad = pedro.guardians[0]?.id as string;
    const missing = await ctx.call<{ error: { message: string } }>(secretary, "POST", `/guardians/${dad}/portal-access`, {});
    expect(missing.status).toBe(400);
    const ok = await ctx.call<PortalAccessDto>(secretary, "POST", `/guardians/${dad}/portal-access`, {
      email: "Carlos.Perez@Correo.hn",
    });
    expect(ok.body.login).toBe("carlos.perez@correo.hn");
    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${pedro.id}`);
    expect(detail.body.guardians[0]?.email).toBe("carlos.perez@correo.hn");
  });

  it("un docente no da acceso al portal", async () => {
    expect((await ctx.call(ana, "POST", `/guardians/${motherId()}/portal-access`, {})).status).toBe(403);
  });

  describe("lo que ve la familia", () => {
    let mom: TestUser;
    beforeAll(async () => {
      mom = await ctx.user("padre", schoolId, "María López Castro", access.userId);
    });

    it("la lista de sus hijos con el resumen del parcial", async () => {
      const res = await ctx.call<FamilyChildSummaryDto[]>(mom, "GET", "/family/children");
      expect(res.body.map((c) => c.name).sort()).toEqual(["Luis López", "Sofía López"]);
      const luisSummary = res.body.find((c) => c.studentId === luis.id);
      expect(luisSummary).toMatchObject({ periodName: "IV Parcial", periodAverage: 86, absences30d: 1, homeworkThisWeek: 1 });
    });

    it("el detalle: notas por actividad, asistencia y la tarea de la semana", async () => {
      const res = await ctx.call<FamilyChildDto>(mom, "GET", `/family/children/${luis.id}`);
      expect(res.status).toBe(200);
      const math = res.body.subjects[0];
      expect(math?.subjectName).toBe("Matemáticas");
      expect(math?.grades[res.body.period?.id ?? ""]).toMatchObject({ points: 43, possible: 50, projected: 86, grade: null });
      expect(math?.activities.map((a) => [a.name, a.points])).toEqual([
        ["Tarea 1", 18],
        ["Prueba", 25],
      ]);
      expect(res.body.attendance).toMatchObject({ absences30d: 1, tardies30d: 1, recordedDays30d: 3 });
      expect(res.body.attendance.recent.map((r) => r.status)).toEqual(["tarde", "ausente"]);
      expect(res.body.homework).toEqual([
        {
          subjectName: "Matemáticas",
          weekStart: TODAY,
          topic: "Fracciones equivalentes",
          homework: "Página 45, ejercicios 1 al 10",
        },
      ]);
    });

    it("no ve a hijos de otras familias ni datos de otro centro", async () => {
      expect((await ctx.call(mom, "GET", `/family/children/${pedro.id}`)).status).toBe(404);
      const elsewhere = await ctx.user("padre", randomUUID(), "Misma cuenta, otro centro", access.userId);
      expect((await ctx.call<FamilyChildSummaryDto[]>(elsewhere, "GET", "/family/children")).body).toEqual([]);
      expect((await ctx.call(elsewhere, "GET", `/family/children/${luis.id}`)).status).toBe(404);
    });

    it("una familia no entra a las pantallas del personal", async () => {
      expect((await ctx.call(mom, "GET", `/students/${luis.id}`)).status).toBe(403);
      expect((await ctx.call(mom, "GET", `/students/${luis.id}/report-card`)).status).toBe(403);
      expect((await ctx.call(mom, "GET", "/follow-up")).status).toBe(403);
    });

    it("la oficina imprime la misma boleta; un docente no", async () => {
      const card = await ctx.call<FamilyChildDto>(secretary, "GET", `/students/${luis.id}/report-card`);
      expect(card.body.student).toMatchObject({ name: "Luis López", sectionLabel: expect.stringContaining("A") });
      expect((await ctx.call(ana, "GET", `/students/${luis.id}/report-card`)).status).toBe(403);
    });

    it("restablecer la contraseña da otra temporal; quitar el acceso deja de mostrar a los hijos", async () => {
      const reset = await ctx.call<PortalAccessDto>(secretary, "POST", `/guardians/${motherId()}/portal-access/reset`);
      expect(reset.body.temporaryPassword).toBeTruthy();
      expect(reset.body.temporaryPassword).not.toBe(access.temporaryPassword);

      expect((await ctx.call(secretary, "DELETE", `/guardians/${motherId()}/portal-access`)).status).toBe(204);
      expect((await ctx.call<FamilyChildSummaryDto[]>(mom, "GET", "/family/children")).body).toEqual([]);
      expect([...ctx.familyAccounts.values()].find((a) => a.userId === access.userId)?.active).toBe(false);
    });
  });
});
