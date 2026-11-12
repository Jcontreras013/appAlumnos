import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  GradingPeriodDto,
  PilotIndicatorsDto,
  PortalAccessDto,
  StudentDetailDto,
} from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lessonPlans, teacherLeaves } from "../src/db/schema";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/**
 * Indicadores del piloto en la semana del 2 al 6 de noviembre de 2026 (5 días hábiles), con un
 * centro que cumple la mitad de cada meta y otro sin año lectivo.
 */

const TODAY = "2026-11-09";
const FROM = "2026-11-02";
const TO = "2026-11-06";
let ctx: AcademicTestContext;
let director: TestUser;
let departmental: TestUser;
let familyUserId: string;
const schoolId = randomUUID();
const emptySchool = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  const ana = await ctx.user("docente", schoolId, "Ana");
  const ceci = await ctx.user("docente", schoolId, "Ceci");
  const beto = await ctx.user("docente", schoolId, "Beto");
  const s = await ctx.seedStructure(director);
  const assign = async (sectionId: string, teacher: TestUser) =>
    (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId,
        subjectId: s.subject.id,
        teacherUserId: teacher.id,
      })
    ).body;
  const mathA = await assign(s.sectionA.id, ana);
  const mathB = await assign(s.sectionB.id, ceci);

  const kids: Record<string, StudentDetailDto> = {};
  for (const [name, sectionId] of [
    ["Luis", s.sectionA.id],
    ["Sara", s.sectionB.id],
  ] as const) {
    kids[name] = (
      await ctx.call<StudentDetailDto>(director, "POST", "/students", {
        firstNames: name,
        lastNames: "Alumno",
        guardians: [
          guardian({
            fullName: `Mamá de ${name}`,
            nationalId: name === "Luis" ? "0801198000001" : undefined,
          }),
        ],
        sectionId,
      })
    ).body;
  }

  // Asistencia: la sección A pasa lista 4 de 5 días; la B, solo 2.
  const take = (sectionId: string, studentId: string, date: string) =>
    ctx.call(director, "PUT", "/attendance", {
      sectionId,
      date,
      entries: [{ studentId, status: "presente" }],
    });
  for (const date of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06"])
    await take(s.sectionA.id, kids.Luis?.id as string, date);
  for (const date of ["2026-11-02", "2026-11-05"]) await take(s.sectionB.id, kids.Sara?.id as string, date);

  // Notas: el último parcial cerrado está completo en la clase A y vacío en la B; en el vigente,
  // la clase A ya tiene puntos para proyectar y la B no.
  const { periods } = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body;
  const closed = periods.filter((p) => p.closesOn <= TO).at(-1) as GradingPeriodDto;
  const current = periods.find((p) => p.startsOn <= TO && TO <= p.endsOn) as GradingPeriodDto;
  const activity = async (periodId: string, maxPoints: number, points: number | null) => {
    const id = randomUUID();
    await ctx.call(director, "PUT", `/activities/${id}`, {
      id,
      assignmentId: mathA.id,
      periodId,
      name: `Actividad ${maxPoints}`,
      maxPoints,
      date: "2026-11-02",
    });
    if (points !== null) {
      await ctx.call(director, "PUT", "/scores", {
        activityId: id,
        entries: [{ studentId: kids.Luis?.id, points }],
      });
    }
  };
  await activity(closed.id, 100, 80);
  await activity(current.id, 25, null);

  // Planificación: la clase A entregó la de esa semana; la B no.
  await ctx.db.insert(lessonPlans).values({
    schoolId,
    assignmentId: mathA.id,
    weekStart: FROM,
    status: "enviada",
    fields: [],
    authorUserId: ana.id,
    submittedAt: new Date("2026-10-30T15:00:00Z"),
  });

  // Licencias: una registrada a tiempo y cubierta; la otra, dos días tarde.
  const leave = async (teacher: TestUser, assignment: AssignmentDto, startsOn: string, createdAt: string) => {
    const created = (
      await ctx.call<{ id: string }>(director, "POST", "/leaves", {
        teacherUserId: teacher.id,
        type: "enfermedad",
        startsOn,
        endsOn: "2026-11-13",
      })
    ).body;
    const sub = await ctx.call(director, "POST", `/leaves/${created.id}/substitutions`, {
      assignmentId: assignment.id,
      substituteUserId: beto.id,
    });
    expect(sub.status).toBe(201);
    await ctx.db
      .update(teacherLeaves)
      .set({ createdAt: new Date(createdAt) })
      .where(eq(teacherLeaves.id, created.id));
  };
  await leave(ana, mathA, "2026-11-04", "2026-11-03T20:00:00Z");
  await leave(ceci, mathB, "2026-11-04", "2026-11-06T20:00:00Z");

  // Familias: la mamá de Luis tiene portal y ya lo usa.
  const access = await ctx.call<PortalAccessDto>(
    director,
    "POST",
    `/guardians/${kids.Luis?.guardians[0]?.id}/portal-access`,
    {},
  );
  familyUserId = access.body.userId;

  departmental = await ctx.regionalUser("director_departamental", [
    { id: schoolId, name: "Escuela Uno", districtName: "Roatán" },
    { id: emptySchool, name: "Escuela Nueva", districtName: "Utila" },
  ]);
  ctx.activity.set(departmental.token, {
    schools: [
      { schoolId, directorActive: true, secretaryActive: true },
      { schoolId: emptySchool, directorActive: true, secretaryActive: false },
    ],
    activatedFamilyUserIds: [familyUserId],
  });
});
afterAll(() => ctx.close());

const pilot = (who: TestUser, query = `?desde=${FROM}&hasta=${TO}`) =>
  ctx.call<PilotIndicatorsDto>(who, "GET", `/regional/pilot${query}`);

describe("indicadores del piloto", () => {
  it("mide cada meta en el centro con los datos de la plataforma", async () => {
    const res = await pilot(departmental);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: FROM, to: TO, businessDays: 5 });
    const uno = res.body.schools.find((s) => s.schoolId === schoolId);
    expect(uno?.measures).toEqual({
      centros_activos: { met: 1, total: 1 },
      asistencia: { met: 1, total: 2 },
      notas: { met: 1, total: 2 },
      planificacion: { met: 1, total: 2 },
      licencias: { met: 1, total: 2 },
      alerta_temprana: { met: 1, total: 2 },
      familias: { met: 1, total: 2 },
    });
  });

  it("un centro sin año lectivo solo cuenta si sus cuentas están activas; los totales suman todo", async () => {
    const { body } = await pilot(departmental);
    const nueva = body.schools.find((s) => s.schoolId === emptySchool);
    expect(nueva?.measures.centros_activos).toEqual({ met: 0, total: 1 });
    expect(nueva?.measures.asistencia).toEqual({ met: 0, total: 0 });
    expect(body.totals.centros_activos).toEqual({ met: 1, total: 2 });
    expect(body.totals.notas).toEqual({ met: 1, total: 2 });
  });

  it("los días que todavía no llegan no cuentan como días sin lista", async () => {
    const res = await pilot(departmental, `?desde=${FROM}&hasta=2026-11-20`);
    // Del 2 al 9 de noviembre (hoy) hay 6 días hábiles: la sección A tiene lista en 4 (67 %).
    expect(res.body.businessDays).toBe(6);
    expect(res.body.totals.asistencia).toEqual({ met: 0, total: 2 });
  });

  it("valida las fechas y solo lo ve la dirección regional", async () => {
    expect((await pilot(departmental, "?desde=2026-11-10&hasta=2026-11-01")).status).toBe(400);
    expect((await pilot(departmental, "?desde=ayer")).status).toBe(400);
    expect((await pilot(director)).status).toBe(403);
  });
});
