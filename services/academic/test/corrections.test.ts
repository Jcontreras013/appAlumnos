import { randomUUID } from "node:crypto";
import type { AssignmentDto, GradeDto, SectionDto, StudentDetailDto, SubjectDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/**
 * Corregir la estructura del centro sin perder información: todo se puede renombrar, pero solo se
 * elimina lo que no tiene alumnos, notas ni registros.
 */

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let director: TestUser;
let ana: TestUser;
let beto: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

type ErrorBody = { error: { message: string } };

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  ana = await ctx.user("docente", schoolId, "Ana Titular");
  beto = await ctx.user("docente", schoolId, "Beto Nuevo");
  structure = await ctx.seedStructure(director);
  for (const firstNames of ["Carla", "Dario"]) {
    await ctx.call<StudentDetailDto>(director, "POST", "/students", {
      firstNames,
      lastNames: "Alumno",
      guardians: [guardian({ fullName: `Encargada de ${firstNames}` })],
      sectionId: structure.sectionA.id,
    });
  }
});
afterAll(() => ctx.close());

describe("grados", () => {
  it("se renombran y cambian de orden; el nombre sigue siendo único", async () => {
    const res = await ctx.call<GradeDto>(director, "PUT", `/grades/${structure.grade.id}`, {
      name: "1er grado",
      sortOrder: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "1er grado", sortOrder: 2 });
    const [section] = (await ctx.call<SectionDto[]>(director, "GET", "/sections")).body;
    expect(section?.label).toBe("1er grado A");

    await ctx.call(director, "POST", "/grades", { name: "Segundo grado" });
    const dup = await ctx.call(director, "PUT", `/grades/${structure.grade.id}`, { name: "Segundo grado" });
    expect(dup.status).toBe(409);
  });

  it("no se elimina un grado con secciones; uno vacío sí", async () => {
    const used = await ctx.call<ErrorBody>(director, "DELETE", `/grades/${structure.grade.id}`);
    expect(used.status).toBe(409);
    expect(used.body.error.message).toContain("2 secciones");

    const empty = (await ctx.call<GradeDto>(director, "POST", "/grades", { name: "Grado por error" })).body;
    expect((await ctx.call(director, "DELETE", `/grades/${empty.id}`)).status).toBe(204);
    const names = (await ctx.call<GradeDto[]>(director, "GET", "/grades")).body.map((g) => g.name);
    expect(names).not.toContain("Grado por error");
  });
});

describe("secciones", () => {
  it("se corrige el nombre y el cupo, pero el cupo no baja de los matriculados", async () => {
    const res = await ctx.call<SectionDto>(director, "PUT", `/sections/${structure.sectionA.id}`, {
      name: "Única",
      capacity: 35,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Única", capacity: 35, enrolledCount: 2 });

    const below = await ctx.call<ErrorBody>(director, "PUT", `/sections/${structure.sectionA.id}`, {
      name: "Única",
      capacity: 1,
    });
    expect(below.status).toBe(409);
    expect(below.body.error.message).toContain("tiene 2 alumnos");
    const unlimited = await ctx.call<SectionDto>(director, "PUT", `/sections/${structure.sectionB.id}`, {
      name: "A",
      capacity: "",
    });
    expect(unlimited.body).toMatchObject({ name: "A", capacity: null });
    const dup = await ctx.call(director, "PUT", `/sections/${structure.sectionB.id}`, { name: "Única" });
    expect(dup.status).toBe(409);
  });

  it("no se elimina una sección con alumnos; una vacía sí", async () => {
    const used = await ctx.call<ErrorBody>(director, "DELETE", `/sections/${structure.sectionA.id}`);
    expect(used.status).toBe(409);
    expect(used.body.error.message).toContain("2 alumnos matriculados");

    expect((await ctx.call(director, "DELETE", `/sections/${structure.sectionB.id}`)).status).toBe(204);
    const left = (await ctx.call<SectionDto[]>(director, "GET", "/sections")).body.map((s) => s.id);
    expect(left).toEqual([structure.sectionA.id]);
  });
});

describe("materias y clases", () => {
  let math: AssignmentDto;
  const activityId = randomUUID();

  beforeAll(async () => {
    math = (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId: structure.sectionA.id,
        subjectId: structure.subject.id,
        teacherUserId: ana.id,
      })
    ).body;
    const { periods } = (await ctx.call<{ periods: Array<{ id: string }> }>(director, "GET", "/periods"))
      .body;
    const res = await ctx.call(ana, "PUT", `/activities/${activityId}`, {
      id: activityId,
      assignmentId: math.id,
      periodId: periods.at(-1)?.id,
      name: "Examen",
      maxPoints: 30,
      date: TODAY,
    });
    expect(res.status).toBe(200);
  });

  it("la materia se renombra; no se elimina mientras se dé en alguna sección", async () => {
    const renamed = await ctx.call<SubjectDto>(director, "PUT", `/subjects/${structure.subject.id}`, {
      name: "Matemática",
    });
    expect(renamed.body.name).toBe("Matemática");
    const used = await ctx.call<ErrorBody>(director, "DELETE", `/subjects/${structure.subject.id}`);
    expect(used.status).toBe(409);
    expect(used.body.error.message).toContain("1 sección");

    const spare = (await ctx.call<SubjectDto>(director, "POST", "/subjects", { name: "Sin usar" })).body;
    expect((await ctx.call(director, "DELETE", `/subjects/${spare.id}`)).status).toBe(204);
  });

  it("quitar una clase con notas está bloqueado: se cambia el docente y las notas se quedan", async () => {
    const remove = await ctx.call<ErrorBody>(director, "DELETE", `/assignments/${math.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.error.message).toContain("1 actividad evaluada");
    expect(remove.body.error.message).toContain("Cambiar docente");

    const changed = await ctx.call<AssignmentDto>(director, "PUT", `/assignments/${math.id}`, {
      teacherUserId: beto.id,
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ teacherName: "Beto Nuevo", teacherUserId: beto.id });

    // El nuevo docente ve el cuaderno con la actividad; la anterior ya no.
    const book = await ctx.call<{ activities: Array<{ id: string }> }>(beto, "GET", `/gradebook/${math.id}`);
    expect(book.body.activities.map((a) => a.id)).toEqual([activityId]);
    expect((await ctx.call(ana, "GET", `/gradebook/${math.id}`)).status).toBe(404);
  });

  it("no cambia el docente mientras la clase tenga una sustitución vigente", async () => {
    const leave = (
      await ctx.call<{ id: string }>(director, "POST", "/leaves", {
        teacherUserId: beto.id,
        type: "enfermedad",
        startsOn: TODAY,
        endsOn: "2026-11-13",
      })
    ).body;
    expect(
      (
        await ctx.call(director, "POST", `/leaves/${leave.id}/substitutions`, {
          assignmentId: math.id,
          substituteUserId: ana.id,
        })
      ).status,
    ).toBe(201);
    const blocked = await ctx.call<ErrorBody>(director, "PUT", `/assignments/${math.id}`, {
      teacherUserId: ana.id,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain("sustitución");
  });

  it("una clase sin trabajo se quita; quien no es docente no puede recibirla", async () => {
    const spare = (await ctx.call<SubjectDto>(director, "POST", "/subjects", { name: "Inglés" })).body;
    const english = (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId: structure.sectionA.id,
        subjectId: spare.id,
        teacherUserId: ana.id,
      })
    ).body;
    const parent = await ctx.user("padre", schoolId);
    expect(
      (await ctx.call(director, "PUT", `/assignments/${english.id}`, { teacherUserId: parent.id })).status,
    ).toBe(400);
    expect((await ctx.call(director, "DELETE", `/assignments/${english.id}`)).status).toBe(204);
  });
});

describe("permisos y aislamiento", () => {
  it("solo dirección y coordinación corrigen; otro centro no ve nada", async () => {
    const secretary = await ctx.user("secretaria", schoolId);
    const teacher = await ctx.user("docente", schoolId);
    const other = await ctx.user("admin", randomUUID());
    const url = `/grades/${structure.grade.id}`;
    expect((await ctx.call(secretary, "PUT", url, { name: "X" })).status).toBe(403);
    expect((await ctx.call(teacher, "DELETE", `/sections/${structure.sectionA.id}`)).status).toBe(403);
    expect((await ctx.call(other, "PUT", url, { name: "Intruso" })).status).toBe(404);
    expect((await ctx.call(other, "DELETE", url)).status).toBe(404);
    expect((await ctx.call(other, "PUT", `/sections/${structure.sectionA.id}`, { name: "Z" })).status).toBe(
      404,
    );
    expect((await ctx.call(other, "DELETE", `/subjects/${structure.subject.id}`)).status).toBe(404);
  });
});

describe("responsables y nombres del personal", () => {
  it("se corrigen los datos del responsable y el parentesco; la identidad no se repite", async () => {
    const [student] = (await ctx.call<{ items: Array<{ id: string }> }>(director, "GET", "/students")).body
      .items;
    const detail = (await ctx.call<StudentDetailDto>(director, "GET", `/students/${student?.id}`)).body;
    const [first] = detail.guardians;
    const res = await ctx.call<StudentDetailDto>(
      director,
      "PUT",
      `/students/${detail.id}/guardians/${first?.id}`,
      {
        fullName: "Carmen Alumno Ruiz",
        relationship: "tutor",
        phone: "3344-5566",
        nationalId: "0801-1985-00007",
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.guardians[0]).toMatchObject({
      fullName: "Carmen Alumno Ruiz",
      relationship: "tutor",
      phone: "33445566",
      nationalId: "0801198500007",
      email: null,
    });

    // Sin teléfono ni correo no se puede contactar.
    const noContact = await ctx.call(director, "PUT", `/students/${detail.id}/guardians/${first?.id}`, {
      fullName: "Carmen Alumno Ruiz",
      relationship: "tutor",
    });
    expect(noContact.status).toBe(400);

    // Otro responsable con esa misma identidad: conflicto, no se fusionan por error.
    const [, other] = (await ctx.call<{ items: Array<{ id: string }> }>(director, "GET", "/students")).body
      .items;
    const otherDetail = (await ctx.call<StudentDetailDto>(director, "GET", `/students/${other?.id}`)).body;
    const dup = await ctx.call<ErrorBody>(
      director,
      "PUT",
      `/students/${otherDetail.id}/guardians/${otherDetail.guardians[0]?.id}`,
      { fullName: "Otra Persona", relationship: "madre", phone: "9999-0000", nationalId: "0801198500007" },
    );
    expect(dup.status).toBe(409);

    const teacher = await ctx.user("docente", schoolId);
    expect(
      (await ctx.call(teacher, "PUT", `/students/${detail.id}/guardians/${first?.id}`, { fullName: "X" }))
        .status,
    ).toBe(403);
  });

  it("al corregir el nombre de un docente se actualizan sus clases", async () => {
    const person = ctx.directory.get(beto.id);
    if (person) person.name = "Roberto Nuevo";
    const res = await ctx.call<{ name: string }>(director, "POST", `/people/${beto.id}/refresh-name`);
    expect(res.body.name).toBe("Roberto Nuevo");
    const classes = (await ctx.call<AssignmentDto[]>(director, "GET", "/assignments")).body;
    expect(classes.filter((a) => a.teacherUserId === beto.id).map((a) => a.teacherName)).toEqual([
      "Roberto Nuevo",
    ]);
    expect((await ctx.call(director, "POST", `/people/${randomUUID()}/refresh-name`)).status).toBe(404);
  });

  it("si lo corrige la departamental, también se actualizan sus clases; fuera de su ámbito, no", async () => {
    const person = ctx.directory.get(beto.id);
    if (person) person.name = "Roberto Corregido";
    const departamental = await ctx.regionalUser("director_departamental", [
      { id: schoolId, name: "Centro" },
    ]);
    const res = await ctx.call<{ name: string }>(
      departamental,
      "POST",
      `/regional/people/${beto.id}/refresh-name`,
    );
    expect(res.status).toBe(200);
    const classes = (await ctx.call<AssignmentDto[]>(director, "GET", "/assignments")).body;
    expect(classes.filter((a) => a.teacherUserId === beto.id).map((a) => a.teacherName)).toEqual([
      "Roberto Corregido",
    ]);

    const elsewhere = await ctx.regionalUser("director_departamental", [{ id: randomUUID(), name: "Otro" }]);
    expect((await ctx.call(elsewhere, "POST", `/regional/people/${beto.id}/refresh-name`)).status).toBe(404);
    expect((await ctx.call(director, "POST", `/regional/people/${beto.id}/refresh-name`)).status).toBe(403);
  });
});
