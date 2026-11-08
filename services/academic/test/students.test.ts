import { randomUUID } from "node:crypto";
import type { SectionDto, StudentDetailDto, StudentListItemDto } from "@escolar/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let admin: TestUser;
let secretary: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolA = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic();
  admin = await ctx.user("admin", schoolA);
  secretary = await ctx.user("secretaria", schoolA, "Sofía Secretaria");
  structure = await ctx.seedStructure(admin, { capacityA: 2 });
});
afterAll(() => ctx.close());

const newStudent = (overrides: Record<string, unknown> = {}) => ({
  firstNames: "Ana Sofía",
  lastNames: "López Castro",
  guardians: [guardian()],
  ...overrides,
});

describe("alta de alumnos", () => {
  it("crea alumno, responsable principal y matrícula en una sola operación", async () => {
    const res = await ctx.call<StudentDetailDto>(
      secretary,
      "POST",
      "/students",
      newStudent({ nationalId: "0801-2019-00001", sectionId: structure.sectionA.id }),
    );
    expect(res.status).toBe(201);
    expect(res.body.nationalId).toBe("0801201900001");
    expect(res.body.guardians).toMatchObject([
      { fullName: "María López Castro", isPrimary: true, phone: "99887766" },
    ]);
    expect(res.body.enrollments).toMatchObject([
      { sectionLabel: "Primer grado A", status: "activa", enrolledOn: "2026-11-09", schoolYearName: "2026" },
    ]);
  });

  it("no permite dos alumnos con la misma identidad", async () => {
    const res = await ctx.call(secretary, "POST", "/students", newStudent({ nationalId: "0801201900001" }));
    expect(res.status).toBe(409);
  });

  it("si la matrícula falla, no queda el alumno a medias (transacción)", async () => {
    const before = (await ctx.call<{ total: number }>(admin, "GET", "/students")).body.total;
    const res = await ctx.call(
      secretary,
      "POST",
      "/students",
      newStudent({ firstNames: "Fantasma", sectionId: randomUUID() }),
    );
    expect(res.status).toBe(404);
    expect((await ctx.call<{ total: number }>(admin, "GET", "/students")).body.total).toBe(before);
  });

  it("los hermanos comparten responsable cuando su identidad coincide", async () => {
    const parent = guardian({ fullName: "José Pérez", relationship: "padre", nationalId: "0801198001234" });
    const first = await ctx.call<StudentDetailDto>(
      secretary,
      "POST",
      "/students",
      newStudent({ firstNames: "Luis", lastNames: "Pérez", guardians: [parent] }),
    );
    const second = await ctx.call<StudentDetailDto>(
      secretary,
      "POST",
      "/students",
      newStudent({
        firstNames: "Marta",
        lastNames: "Pérez",
        guardians: [{ ...parent, phone: undefined, email: "jose@correo.hn" }],
      }),
    );
    expect(second.body.guardians[0]?.id).toBe(first.body.guardians[0]?.id);
    expect(second.body.siblings.map((s) => s.fullName)).toEqual(["Luis Pérez"]);
    // completó el correo que le faltaba sin borrar el teléfono
    expect(second.body.guardians[0]).toMatchObject({ phone: "99887766", email: "jose@correo.hn" });
  });
});

describe("cupo y matrícula", () => {
  it("no deja pasar del cupo de la sección", async () => {
    // Sección A tiene cupo 2 y ya hay 1 matriculado
    const ok = await ctx.call(
      secretary,
      "POST",
      "/students",
      newStudent({ firstNames: "Beto", sectionId: structure.sectionA.id }),
    );
    expect(ok.status).toBe(201);
    const full = await ctx.call<{ error: { message: string } }>(
      secretary,
      "POST",
      "/students",
      newStudent({ firstNames: "Carla", sectionId: structure.sectionA.id }),
    );
    expect(full.status).toBe(409);
    expect(full.body.error.message).toContain("está llena");
  });

  it("matrículas simultáneas no sobrepasan el cupo", async () => {
    const section = (
      await ctx.call<SectionDto>(admin, "POST", "/sections", {
        schoolYearId: structure.year.id,
        gradeId: structure.grade.id,
        name: "C",
        capacity: 3,
      })
    ).body;
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        ctx.call(
          secretary,
          "POST",
          "/students",
          newStudent({ firstNames: `Simultáneo ${i}`, sectionId: section.id }),
        ),
      ),
    );
    expect(attempts.filter((a) => a.status === 201)).toHaveLength(3);
    const [after] = (await ctx.call<SectionDto[]>(admin, "GET", "/sections")).body.filter(
      (s) => s.id === section.id,
    );
    expect(after?.enrolledCount).toBe(3);
  });

  it("retirar libera el cupo y volver a matricular reactiva la misma matrícula", async () => {
    const list = (
      await ctx.call<{ items: StudentListItemDto[] }>(
        admin,
        "GET",
        `/students?sectionId=${structure.sectionA.id}`,
      )
    ).body.items;
    const target = list.find((s) => s.firstNames === "Beto");
    const withdrawn = await ctx.call<StudentDetailDto>(
      secretary,
      "POST",
      `/enrollments/${target?.enrollment?.id}/withdraw`,
      { withdrawnOn: "2026-11-10", reason: "Cambio de domicilio" },
    );
    expect(withdrawn.body.enrollments[0]).toMatchObject({
      status: "retirada",
      withdrawReason: "Cambio de domicilio",
    });

    const sections = (await ctx.call<SectionDto[]>(admin, "GET", "/sections")).body;
    expect(sections.find((s) => s.id === structure.sectionA.id)?.enrolledCount).toBe(1);

    const back = await ctx.call<StudentDetailDto>(secretary, "POST", "/enrollments", {
      studentId: target?.id,
      sectionId: structure.sectionB.id,
    });
    expect(back.status).toBe(200);
    expect(back.body.enrollments).toHaveLength(1);
    expect(back.body.enrollments[0]).toMatchObject({ status: "activa", sectionLabel: "Primer grado B" });
  });

  it("no matricula dos veces en el mismo año", async () => {
    const [student] = (
      await ctx.call<{ items: StudentListItemDto[] }>(admin, "GET", "/students?estado=matriculados")
    ).body.items;
    const res = await ctx.call<{ error: { message: string } }>(secretary, "POST", "/enrollments", {
      studentId: student?.id,
      sectionId: structure.sectionB.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("ya está matriculado");
  });

  it("cambio de sección respeta el cupo destino", async () => {
    const inB = (
      await ctx.call<{ items: StudentListItemDto[] }>(
        admin,
        "GET",
        `/students?sectionId=${structure.sectionB.id}`,
      )
    ).body.items[0];
    const full = await ctx.call(secretary, "POST", `/enrollments/${inB?.enrollment?.id}/transfer`, {
      sectionId: structure.sectionA.id,
    });
    // A tiene cupo 2 con 1 alumno: cabe
    expect(full.status).toBe(200);
  });
});

describe("búsqueda y permisos", () => {
  it("busca por nombre en cualquier orden y por identidad", async () => {
    const byName = await ctx.call<{ items: StudentListItemDto[] }>(admin, "GET", "/students?q=castro%20ana");
    const byReverse = await ctx.call<{ items: StudentListItemDto[] }>(admin, "GET", "/students?q=ana%20sof");
    const byId = await ctx.call<{ items: StudentListItemDto[] }>(admin, "GET", "/students?q=0801-2019");
    expect(byName.body.items.map((s) => s.firstNames)).toContain("Ana Sofía");
    expect(byReverse.body.items.map((s) => s.firstNames)).toContain("Ana Sofía");
    expect(byId.body.items.map((s) => s.nationalId)).toEqual(["0801201900001"]);
  });

  it("muestra al responsable principal y alumnos sin matrícula", async () => {
    const res = await ctx.call<{ items: StudentListItemDto[] }>(
      admin,
      "GET",
      "/students?estado=sin_matricula",
    );
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((s) => s.enrollment === null && s.primaryGuardian !== null)).toBe(true);
  });

  it("otro colegio no ve ni toca a estos alumnos", async () => {
    const other = await ctx.user("admin", randomUUID());
    const [student] = (await ctx.call<{ items: StudentListItemDto[] }>(admin, "GET", "/students")).body.items;
    expect((await ctx.call<{ total: number }>(other, "GET", "/students")).body.total).toBe(0);
    expect((await ctx.call(other, "GET", `/students/${student?.id}`)).status).toBe(404);
    expect(
      (
        await ctx.call(other, "POST", "/enrollments", {
          studentId: student?.id,
          sectionId: structure.sectionB.id,
        })
      ).status,
    ).toBe(404);
  });

  it("docentes y padres no acceden a los datos de matrícula", async () => {
    expect((await ctx.call(await ctx.user("docente", schoolA), "GET", "/students")).status).toBe(403);
    expect((await ctx.call(await ctx.user("padre", schoolA), "GET", "/students")).status).toBe(403);
    const coordinator = await ctx.user("coordinador", schoolA);
    expect((await ctx.call(coordinator, "GET", "/students")).status).toBe(200);
    expect((await ctx.call(coordinator, "POST", "/students", newStudent())).status).toBe(403);
  });
});

describe("responsables", () => {
  it("no se puede quitar al único responsable ni al principal", async () => {
    const created = (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", newStudent({ firstNames: "Iris" }))
    ).body;
    const only = created.guardians[0]?.id;
    expect((await ctx.call(secretary, "DELETE", `/students/${created.id}/guardians/${only}`)).status).toBe(
      400,
    );

    const withSecond = (
      await ctx.call<StudentDetailDto>(secretary, "POST", `/students/${created.id}/guardians`, {
        fullName: "Pedro Ruiz",
        relationship: "padre",
        email: "pedro@correo.hn",
      })
    ).body;
    const second = withSecond.guardians.find((g) => g.fullName === "Pedro Ruiz");
    expect((await ctx.call(secretary, "DELETE", `/students/${created.id}/guardians/${only}`)).status).toBe(
      400,
    );

    await ctx.call(secretary, "POST", `/students/${created.id}/guardians/${second?.id}/primary`);
    const after = await ctx.call<StudentDetailDto>(
      secretary,
      "DELETE",
      `/students/${created.id}/guardians/${only}`,
    );
    expect(after.status).toBe(200);
    expect(after.body.guardians).toMatchObject([{ fullName: "Pedro Ruiz", isPrimary: true }]);
  });
});

describe("bitácora", () => {
  it("registra cada cambio y no se puede alterar", async () => {
    const result = await ctx.db.execute(
      sql`select count(*)::int as n from audit_events where action = 'student.created'`,
    );
    expect((result as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBeGreaterThan(3);
    await expect(ctx.db.execute(sql`delete from audit_events`)).rejects.toThrow();
  });
});
