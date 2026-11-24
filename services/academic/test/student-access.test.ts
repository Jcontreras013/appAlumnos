import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  FamilyChildDto,
  GradingPeriodDto,
  SectionStudentAccessDto,
  StudentAccessDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser;
let math1A: AssignmentDto;
let luis: StudentDetailDto;
let sofia: StudentDetailDto;
let pedro: StudentDetailDto;
let sectionA: string;
const schoolId = randomUUID();
const TODAY = "2026-11-09";

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  const s = await ctx.seedStructure(director);
  sectionA = s.sectionA.id;
  math1A = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: s.sectionA.id,
      subjectId: s.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  const create = async (firstNames: string, nationalId?: string) =>
    (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames,
        lastNames: "López",
        nationalId,
        guardians: [guardian()],
        sectionId: s.sectionA.id,
      })
    ).body;
  luis = await create("Luis", "0801201105555");
  sofia = await create("Sofía", "0801201206666");
  pedro = await create("Pedro");

  const periods = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body.periods;
  const id = randomUUID();
  await ctx.call(ana, "PUT", `/activities/${id}`, {
    id,
    assignmentId: math1A.id,
    periodId: (periods[3] as GradingPeriodDto).id,
    name: "Tarea 1",
    maxPoints: 20,
    date: TODAY,
  });
  await ctx.call(ana, "PUT", "/scores", { activityId: id, entries: [{ studentId: luis.id, points: 17 }] });
});
afterAll(() => ctx.close());

describe("cuentas de los alumnos", () => {
  let access: StudentAccessDto;

  it("la secretaría le da su cuenta a Luis: entra con su identidad y queda en su ficha", async () => {
    const res = await ctx.call<StudentAccessDto>(
      secretary,
      "POST",
      `/students/${luis.id}/student-access`,
      {},
    );
    expect(res.status).toBe(200);
    access = res.body;
    expect(access).toMatchObject({
      studentId: luis.id,
      studentName: "Luis López",
      sectionLabel: "Primer grado A",
      login: "0801201105555",
    });
    expect(access.temporaryPassword).toBeTruthy();
    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${luis.id}`);
    expect(detail.body.hasStudentAccess).toBe(true);
  });

  it("sin identidad ni correo hay que escribir uno; el correo queda en la ficha", async () => {
    const missing = await ctx.call(secretary, "POST", `/students/${pedro.id}/student-access`, {});
    expect(missing.status).toBe(400);
    const res = await ctx.call<StudentAccessDto>(secretary, "POST", `/students/${pedro.id}/student-access`, {
      email: "pedro@alumnos.hn",
    });
    expect(res.status).toBe(200);
    expect(res.body.login).toBe("pedro@alumnos.hn");
    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${pedro.id}`);
    expect(detail.body.email).toBe("pedro@alumnos.hn");
  });

  it("un docente no da cuentas de alumno", async () => {
    expect((await ctx.call(ana, "POST", `/students/${sofia.id}/student-access`, {})).status).toBe(403);
  });

  it("el alumno ve sus notas (lo mismo que su familia) y nada del personal", async () => {
    const me = await ctx.user("estudiante", schoolId, "Luis López", access.userId);
    const res = await ctx.call<FamilyChildDto>(me, "GET", "/student/me");
    expect(res.status).toBe(200);
    expect(res.body.student.id).toBe(luis.id);
    expect(JSON.stringify(res.body)).toContain("Tarea 1");
    expect((await ctx.call(me, "GET", "/students")).status).toBe(403);
    expect((await ctx.call(me, "GET", `/gradebook/${math1A.id}`)).status).toBe(403);
  });

  it("en la biblioteca ve lo compartido con las familias de su grado, no lo del personal", async () => {
    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${luis.id}`);
    const sectionId = detail.body.enrollments[0]?.sectionId as string;
    const sections = await ctx.call<Array<{ id: string; gradeId: string }>>(director, "GET", "/sections");
    const gradeId = sections.body.find((x) => x.id === sectionId)?.gradeId;
    for (const [title, audience] of [
      ["Guía para la casa", "familias"],
      ["Respuestas del docente", "personal"],
    ] as const) {
      await ctx.call(ana, "POST", "/library/links", {
        title,
        url: "https://www.educatrachos.hn/",
        gradeId,
        audience,
      });
    }
    const me = await ctx.user("estudiante", schoolId, "Luis López", access.userId);
    const res = await ctx.call<Array<{ title: string; canDelete: boolean }>>(me, "GET", "/library");
    expect(res.status).toBe(200);
    expect(res.body.map((i) => i.title)).toEqual(["Guía para la casa"]);
    expect(res.body[0]?.canDelete).toBe(false);
  });

  it("una cuenta de alumno que no está ligada a nadie no ve nada", async () => {
    const stranger = await ctx.user("estudiante", schoolId, "Desconocido");
    expect((await ctx.call(stranger, "GET", "/student/me")).status).toBe(404);
  });

  it("toda la sección de una vez: crea las que faltan y avisa de las que ya tenían", async () => {
    const res = await ctx.call<SectionStudentAccessDto>(
      secretary,
      "POST",
      `/sections/${sectionA}/student-access`,
    );
    expect(res.status).toBe(200);
    expect(res.body.alreadyActive).toBe(2); // Luis y Pedro
    expect(res.body.created.map((c) => c.studentName)).toEqual(["Sofía López"]);
    expect(res.body.created[0]?.temporaryPassword).toBeTruthy();
    expect(res.body.skipped).toEqual([]);
  });

  it("nueva contraseña temporal y quitar la cuenta", async () => {
    const reset = await ctx.call<StudentAccessDto>(
      secretary,
      "POST",
      `/students/${luis.id}/student-access/reset`,
    );
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toBeTruthy();
    const del = await ctx.call(secretary, "DELETE", `/students/${luis.id}/student-access`);
    expect(del.status).toBe(204);
    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${luis.id}`);
    expect(detail.body.hasStudentAccess).toBe(false);
    const me = await ctx.user("estudiante", schoolId, "Luis López", access.userId);
    expect((await ctx.call(me, "GET", "/student/me")).status).toBe(404);
  });
});
