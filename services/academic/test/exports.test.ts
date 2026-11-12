import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  GradingPeriodDto,
  RegionalExportDto,
  SchoolExportDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let director: TestUser;
let ana: TestUser;
let math: AssignmentDto;
let kids: [string, string];
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  ana = await ctx.user("docente", schoolId, "Ana Titular");
  const structure = await ctx.seedStructure(director);
  math = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: structure.sectionA.id,
      subjectId: structure.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  const ids: string[] = [];
  for (const [first, nationalId] of [
    ["Beto", "0801-2015-00002"],
    ["Ana", ""],
  ] as const) {
    const s = await ctx.call<StudentDetailDto>(director, "POST", "/students", {
      firstNames: first,
      lastNames: "Alumno",
      nationalId,
      guardians: [guardian({ fullName: `Mamá de ${first}`, phone: "9988-7766" })],
      sectionId: structure.sectionA.id,
    });
    ids.push(s.body.id);
  }
  kids = ids as [string, string];
  // Un alumno sin matrícula este año también sale en la lista.
  await ctx.call(director, "POST", "/students", {
    firstNames: "Zoe",
    lastNames: "Sin Matrícula",
    guardians: [guardian()],
  });

  // IV Parcial completo para Beto (60 + 40 puntos) y a medias para Ana.
  const { periods } = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body;
  const current = periods.at(-1) as GradingPeriodDto;
  for (const [name, maxPoints, scores] of [
    ["Examen", 60, [50, 30]],
    ["Proyecto", 40, [35, null]],
  ] as const) {
    const id = randomUUID();
    await ctx.call(ana, "PUT", `/activities/${id}`, {
      id,
      assignmentId: math.id,
      periodId: current.id,
      name,
      maxPoints,
      date: TODAY,
    });
    await ctx.call(ana, "PUT", "/scores", {
      activityId: id,
      entries: kids.map((studentId, i) => ({ studentId, points: scores[i] })),
    });
  }
  for (const [date, statuses] of [
    ["2026-11-05", ["presente", "ausente"]],
    ["2026-11-06", ["tarde", "justificada"]],
    ["2026-11-09", ["presente", "presente"]],
  ] as const) {
    await ctx.call(ana, "PUT", "/attendance", {
      sectionId: structure.sectionA.id,
      date,
      entries: kids.map((studentId, i) => ({ studentId, status: statuses[i] })),
    });
  }
});
afterAll(() => ctx.close());

describe("exportar los datos del centro", () => {
  it("trae la matrícula con el responsable principal, incluidos los alumnos sin matrícula", async () => {
    const res = await ctx.call<SchoolExportDto>(director, "GET", "/export/school");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ schoolYear: "2026", generatedOn: TODAY });
    expect(res.body.periods).toEqual(["I Parcial", "II Parcial", "III Parcial", "IV Parcial"]);
    expect(res.body.students.map((s) => s.firstNames)).toEqual(["Ana", "Beto", "Zoe"]);
    expect(res.body.students[1]).toMatchObject({
      nationalId: "0801201500002",
      gradeName: "Primer grado",
      sectionName: "A",
      status: "activa",
      guardianName: "Mamá de Beto",
      guardianRelationship: "madre",
      guardianPhone: "99887766",
    });
    expect(res.body.students[2]).toMatchObject({ status: null, gradeName: null });
  });

  it("trae la nota de cada parcial, con la misma regla del cuadro de calificaciones", async () => {
    const { grades } = (await ctx.call<SchoolExportDto>(director, "GET", "/export/school")).body;
    const beto = grades.find((g) => g.studentName === "Alumno, Beto");
    const ana_ = grades.find((g) => g.studentName === "Alumno, Ana");
    expect(beto).toMatchObject({
      subjectName: "Matemáticas",
      teacherName: "Ana Titular",
      periods: [null, null, null, 85],
      average: 85,
    });
    // Los parciales sin sus 100 puntos repartidos quedan vacíos; con los 100 repartidos, lo que no
    // se calificó cuenta como cero (igual que en el cuadro que se pasa al SACE).
    expect(ana_?.periods).toEqual([null, null, null, 30]);
    expect(ana_?.average).toBe(30);
  });

  it("resume la asistencia por alumno y da el detalle de cada día", async () => {
    const { attendance, attendanceDays } = (
      await ctx.call<SchoolExportDto>(director, "GET", "/export/school")
    ).body;
    const beto = attendance.find((a) => a.studentName === "Alumno, Beto");
    expect(beto).toMatchObject({ days: 3, present: 2, late: 1, absent: 0, justified: 0, rate: 1 });
    const ana_ = attendance.find((a) => a.studentName === "Alumno, Ana");
    // La justificada no cuenta: 1 presente de 2 días contados.
    expect(ana_).toMatchObject({ days: 3, absent: 1, justified: 1, rate: 0.5 });
    expect(attendanceDays).toHaveLength(6);
    expect(attendanceDays[0]).toMatchObject({
      date: "2026-11-05",
      studentName: "Alumno, Ana",
      status: "ausente",
    });
  });

  it("solo la oficina descarga, y cada centro solo lo suyo", async () => {
    expect((await ctx.call(ana, "GET", "/export/school")).status).toBe(403);
    const parent = await ctx.user("padre", schoolId);
    expect((await ctx.call(parent, "GET", "/export/school")).status).toBe(403);
    const other = await ctx.user("secretaria", randomUUID());
    const theirs = await ctx.call<SchoolExportDto>(other, "GET", "/export/school");
    expect(theirs.body.students).toEqual([]);
  });
});

describe("exportar el ámbito de la departamental", () => {
  it("trae el resumen de cada centro y la matrícula de todos, con su centro", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [
      { id: schoolId, name: "Escuela Uno", districtName: "Roatán" },
    ]);
    const res = await ctx.call<RegionalExportDto>(departmental, "GET", "/regional/export");
    expect(res.status).toBe(200);
    expect(res.body.schools).toHaveLength(1);
    expect(res.body.schools[0]).toMatchObject({ schoolName: "Escuela Uno", students: 2 });
    expect(res.body.students).toHaveLength(3);
    expect(res.body.students[0]).toMatchObject({ schoolName: "Escuela Uno", districtName: "Roatán" });
    expect((await ctx.call(director, "GET", "/regional/export")).status).toBe(403);
  });
});
