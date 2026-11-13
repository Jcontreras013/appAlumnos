import { randomUUID } from "node:crypto";
import type { AssignmentDto, GradingPeriodDto, StudentDetailDto, TransferDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Traslado de un alumno de la Escuela A a la Escuela B, del mismo departamento. */

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let adminA: TestUser;
let adminB: TestUser;
let secretaryB: TestUser;
let luis: StudentDetailDto;
let sectionB: string;
let transfer: TransferDto;
const schoolA = randomUUID();
const schoolB = randomUUID();
const school = (id: string, name: string) => ({
  id,
  slug: id,
  name,
  rtn: null,
  code: null,
  sector: "publico" as const,
  districtId: null,
  districtName: "Roatán",
  active: true,
  logoVersion: null,
  createdAt: new Date().toISOString(),
});

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  adminA = await ctx.user("admin", schoolA, "Dirección A");
  adminB = await ctx.user("admin", schoolB, "Dirección B");
  secretaryB = await ctx.user("secretaria", schoolB, "Secretaría B");
  ctx.scopes.set(adminA.token, [school(schoolA, "Escuela A")]);
  ctx.transferTargets.set(adminA.token, [
    { id: schoolB, name: "Escuela B", code: "B-1", districtName: "Roatán" },
  ]);

  const a = await ctx.seedStructure(adminA);
  const teacher = await ctx.user("docente", schoolA);
  const math = (
    await ctx.call<AssignmentDto>(adminA, "POST", "/assignments", {
      sectionId: a.sectionA.id,
      subjectId: a.subject.id,
      teacherUserId: teacher.id,
    })
  ).body;
  luis = (
    await ctx.call<StudentDetailDto>(adminA, "POST", "/students", {
      firstNames: "Luis",
      lastNames: "Trasladado",
      nationalId: "0801-2015-00001",
      guardians: [
        guardian({ nationalId: "0801-1985-00001" }),
        guardian({ fullName: "Papá de Luis", relationship: "padre", phone: "3333-4444" }),
      ],
      sectionId: a.sectionA.id,
    })
  ).body;
  // III Parcial completo con 85 y un día de ausencia.
  const { periods } = (await ctx.call<{ periods: GradingPeriodDto[] }>(adminA, "GET", "/periods")).body;
  const activityId = randomUUID();
  await ctx.call(adminA, "PUT", `/activities/${activityId}`, {
    id: activityId,
    assignmentId: math.id,
    periodId: periods[2]?.id,
    name: "Examen",
    maxPoints: 100,
    date: "2026-08-01",
  });
  await ctx.call(adminA, "PUT", "/scores", { activityId, entries: [{ studentId: luis.id, points: 85 }] });
  await ctx.call(adminA, "PUT", "/attendance", {
    sectionId: a.sectionA.id,
    date: "2026-11-02",
    entries: [{ studentId: luis.id, status: "ausente" }],
  });

  const b = await ctx.seedStructure(adminB);
  sectionB = b.sectionB.id;
});
afterAll(() => ctx.close());

describe("enviar el traslado", () => {
  it("solo a centros del departamento, y retira la matrícula en el centro de origen", async () => {
    const wrong = await ctx.call(adminA, "POST", `/students/${luis.id}/transfers`, {
      toSchoolId: randomUUID(),
      date: TODAY,
    });
    expect(wrong.status).toBe(400);

    const res = await ctx.call<TransferDto>(adminA, "POST", `/students/${luis.id}/transfers`, {
      toSchoolId: schoolB,
      date: TODAY,
      notes: "Se mudaron a Coxen Hole",
    });
    expect(res.status).toBe(201);
    transfer = res.body;
    expect(transfer).toMatchObject({
      status: "pendiente",
      fromSchoolName: "Escuela A",
      toSchoolName: "Escuela B",
    });
    expect(transfer.snapshot.guardians).toHaveLength(2);
    expect(transfer.snapshot.history).toMatchObject({
      sectionLabel: "Primer grado A",
      subjects: [{ name: "Matemáticas", grades: [null, null, 85, null] }],
      attendance: { days: 1, absent: 1, rate: 0 },
    });

    const inA = (await ctx.call<StudentDetailDto>(adminA, "GET", `/students/${luis.id}`)).body;
    expect(inA.enrollments[0]).toMatchObject({ status: "retirada", withdrawReason: "Traslado a Escuela B" });
    const again = await ctx.call(adminA, "POST", `/students/${luis.id}/transfers`, {
      toSchoolId: schoolB,
      date: TODAY,
    });
    expect(again.status).toBe(409);
  });
});

describe("recibir el traslado", () => {
  it("el destino lo ve pendiente; otros centros no", async () => {
    const list = (await ctx.call<{ incoming: TransferDto[] }>(secretaryB, "GET", "/transfers")).body;
    expect(list.incoming.map((t) => t.studentName)).toEqual(["Luis Trasladado"]);
    const other = await ctx.user("admin", randomUUID());
    expect((await ctx.call<{ incoming: TransferDto[] }>(other, "GET", "/transfers")).body.incoming).toEqual(
      [],
    );
    expect(
      (await ctx.call(other, "POST", `/transfers/${transfer.id}/receive`, { sectionId: sectionB })).status,
    ).toBe(404);
  });

  it("al recibirlo queda matriculado, con sus responsables y su historial", async () => {
    const res = await ctx.call<TransferDto>(secretaryB, "POST", `/transfers/${transfer.id}/receive`, {
      sectionId: sectionB,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("recibido");
    const inB = (await ctx.call<StudentDetailDto>(adminB, "GET", `/students/${res.body.studentId}`)).body;
    expect(inB).toMatchObject({ firstNames: "Luis", nationalId: "0801201500001" });
    expect(inB.enrollments[0]).toMatchObject({ status: "activa", sectionLabel: "Primer grado B" });
    expect(inB.guardians.map((g) => g.fullName).sort()).toEqual(["María López Castro", "Papá de Luis"]);
    expect(inB.guardians.filter((g) => g.isPrimary)).toHaveLength(1);

    const history = (await ctx.call<TransferDto[]>(adminB, "GET", `/students/${inB.id}/transfers`)).body;
    expect(history[0]?.snapshot.history.subjects[0]?.grades[2]).toBe(85);
    expect(history[0]?.direction).toBe("entrada");
    const inOrigin = (await ctx.call<TransferDto[]>(adminA, "GET", `/students/${luis.id}/transfers`)).body;
    expect(inOrigin[0]?.direction).toBe("salida");
    const outgoing = (await ctx.call<{ outgoing: TransferDto[] }>(adminA, "GET", "/transfers")).body.outgoing;
    expect(outgoing[0]?.status).toBe("recibido");
  });

  it("no se recibe dos veces ni se anula algo ya recibido", async () => {
    expect(
      (await ctx.call(secretaryB, "POST", `/transfers/${transfer.id}/receive`, { sectionId: sectionB }))
        .status,
    ).toBe(409);
    expect((await ctx.call(adminA, "POST", `/transfers/${transfer.id}/cancel`)).status).toBe(404);
  });

  it("el origen puede anular un traslado pendiente; los docentes no trasladan", async () => {
    const ana = (
      await ctx.call<StudentDetailDto>(adminA, "POST", "/students", {
        firstNames: "Ana",
        lastNames: "Se Queda",
        guardians: [guardian({ fullName: "Mamá de Ana", nationalId: "0801-1985-00002" })],
      })
    ).body;
    const sent = (
      await ctx.call<TransferDto>(adminA, "POST", `/students/${ana.id}/transfers`, {
        toSchoolId: schoolB,
        date: TODAY,
      })
    ).body;
    expect((await ctx.call<TransferDto>(adminA, "POST", `/transfers/${sent.id}/cancel`)).body.status).toBe(
      "cancelado",
    );
    const teacher = await ctx.user("docente", schoolA);
    expect(
      (await ctx.call(teacher, "POST", `/students/${ana.id}/transfers`, { toSchoolId: schoolB, date: TODAY }))
        .status,
    ).toBe(403);
  });
});
