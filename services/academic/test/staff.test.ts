import { randomUUID } from "node:crypto";
import type { AssignmentDto, CoverageDto, LeaveDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let ana: TestUser; // titular
let beto: TestUser; // sustituto
let ceci: TestUser;
let math1A: AssignmentDto;
let math1B: AssignmentDto;
let spanish1A: AssignmentDto;
let leave: LeaveDto;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
  director = await ctx.user("admin", schoolId, "Directora");
  ana = await ctx.user("docente", schoolId, "Ana Titular");
  beto = await ctx.user("docente", schoolId, "Beto Sustituto");
  ceci = await ctx.user("docente", schoolId, "Ceci Docente");
  const s = await ctx.seedStructure(director);
  const spanish = (await ctx.call<{ id: string }>(director, "POST", "/subjects", { name: "Español" })).body;
  const assign = async (sectionId: string, subjectId: string, teacher: TestUser) =>
    (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId,
        subjectId,
        teacherUserId: teacher.id,
      })
    ).body;
  math1A = await assign(s.sectionA.id, s.subject.id, ana);
  math1B = await assign(s.sectionB.id, s.subject.id, ana);
  spanish1A = await assign(s.sectionA.id, spanish.id, ceci);
});
afterAll(() => ctx.close());

const coverage = async (fecha?: string) =>
  (await ctx.call<CoverageDto>(director, "GET", `/coverage${fecha ? `?fecha=${fecha}` : ""}`)).body;
const addSub = (payload: Record<string, unknown>, leaveId = leave.id) =>
  ctx.call<LeaveDto & { error?: { message: string } }>(
    director,
    "POST",
    `/leaves/${leaveId}/substitutions`,
    payload,
  );

describe("licencias", () => {
  it("registra la licencia y muestra las clases que quedan sin maestro", async () => {
    const res = await ctx.call<LeaveDto>(director, "POST", "/leaves", {
      teacherUserId: ana.id,
      type: "enfermedad",
      startsOn: "2026-11-09",
      endsOn: "2026-11-13",
      notes: "Incapacidad médica",
    });
    expect(res.status).toBe(201);
    leave = res.body;
    expect(leave).toMatchObject({ teacherName: "Ana Titular", createdByName: "Directora", cancelled: false });
    expect(leave.classes.map((c) => c.assignment.id).sort()).toEqual([math1A.id, math1B.id].sort());

    const today = await coverage();
    expect(today.totals).toEqual({ normal: 1, cubierta: 0, sin_cubrir: 2 });
    expect(today.teachersOnLeave).toBe(1);
  });

  it("no permite licencias que se crucen para el mismo maestro", async () => {
    const res = await ctx.call<{ error: { message: string } }>(director, "POST", "/leaves", {
      teacherUserId: ana.id,
      type: "vacaciones",
      startsOn: "2026-11-12",
      endsOn: "2026-11-20",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("ya tiene una licencia");
  });

  it("valida fechas y al maestro contra identity", async () => {
    expect(
      (
        await ctx.call(director, "POST", "/leaves", {
          teacherUserId: beto.id,
          type: "vacaciones",
          startsOn: "2026-11-20",
          endsOn: "2026-11-10",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.call(director, "POST", "/leaves", {
          teacherUserId: randomUUID(),
          type: "vacaciones",
          startsOn: "2026-11-20",
          endsOn: "2026-11-21",
        })
      ).status,
    ).toBe(400);
  });
});

describe("sustituciones", () => {
  it("asigna un sustituto y la clase pasa a estar cubierta", async () => {
    const res = await addSub({ assignmentId: math1A.id, substituteUserId: beto.id });
    expect(res.status).toBe(201);
    const covered = res.body.classes.find((c) => c.assignment.id === math1A.id);
    expect(covered?.substitution).toMatchObject({
      substituteName: "Beto Sustituto",
      startsOn: "2026-11-09",
      endsOn: "2026-11-13",
    });
    expect((await coverage()).totals).toEqual({ normal: 1, cubierta: 1, sin_cubrir: 1 });
  });

  it("rechaza casos que no tienen sentido", async () => {
    // el mismo titular
    expect((await addSub({ assignmentId: math1B.id, substituteUserId: ana.id })).status).toBe(400);
    // una clase que no es del maestro de licencia
    const notHis = await addSub({ assignmentId: spanish1A.id, substituteUserId: beto.id });
    expect(notHis.status).toBe(400);
    expect(notHis.body.error?.message).toContain("no es de Ana Titular");
    // fechas fuera de la licencia
    expect(
      (await addSub({ assignmentId: math1B.id, substituteUserId: beto.id, endsOn: "2026-11-30" })).status,
    ).toBe(400);
    // la misma clase dos veces
    expect((await addSub({ assignmentId: math1A.id, substituteUserId: ceci.id })).status).toBe(409);
  });

  it("no se puede poner de sustituto a alguien que también está de licencia", async () => {
    await ctx.call(director, "POST", "/leaves", {
      teacherUserId: ceci.id,
      type: "capacitacion",
      startsOn: "2026-11-10",
      endsOn: "2026-11-11",
    });
    const res = await addSub({ assignmentId: math1B.id, substituteUserId: ceci.id });
    expect(res.status).toBe(409);
    expect(res.body.error?.message).toContain("también tiene licencia");
  });

  it("cuando termina la licencia, las clases vuelven solas a su titular", async () => {
    const after = await coverage("2026-11-16");
    expect(after.totals.sin_cubrir).toBe(0);
    expect(after.rows.find((r) => r.assignment.id === math1A.id)?.status).toBe("normal");
  });

  it("quitar el sustituto o cancelar la licencia deja el historial", async () => {
    const sub = (await ctx.call<LeaveDto>(director, "GET", `/leaves/${leave.id}`)).body.classes.find(
      (c) => c.assignment.id === math1A.id,
    )?.substitution;
    await ctx.call(director, "POST", `/substitutions/${sub?.id}/cancel`);
    expect((await coverage()).totals.sin_cubrir).toBe(2);

    const cancelled = await ctx.call<LeaveDto>(director, "POST", `/leaves/${leave.id}/cancel`);
    expect(cancelled.body.cancelled).toBe(true);
    expect((await coverage()).totals).toEqual({ normal: 3, cubierta: 0, sin_cubrir: 0 });
    const history = (await ctx.call<LeaveDto[]>(director, "GET", "/leaves?estado=canceladas")).body;
    expect(history.map((l) => l.id)).toContain(leave.id);
  });
});

describe("permisos", () => {
  it("docentes no registran licencias; secretaría consulta pero no modifica", async () => {
    const payload = {
      teacherUserId: beto.id,
      type: "personal",
      startsOn: "2026-12-01",
      endsOn: "2026-12-01",
    };
    expect((await ctx.call(ana, "POST", "/leaves", payload)).status).toBe(403);
    const secretary = await ctx.user("secretaria", schoolId);
    expect((await ctx.call(secretary, "POST", "/leaves", payload)).status).toBe(403);
    expect((await ctx.call(secretary, "GET", "/leaves")).status).toBe(200);
  });

  it("otro centro no ve ni toca estas licencias", async () => {
    const other = await ctx.user("admin", randomUUID());
    expect((await ctx.call(other, "GET", `/leaves/${leave.id}`)).status).toBe(404);
    expect((await ctx.call(other, "POST", `/leaves/${leave.id}/cancel`)).status).toBe(404);
    expect((await ctx.call<LeaveDto[]>(other, "GET", "/leaves")).body).toEqual([]);
  });
});
