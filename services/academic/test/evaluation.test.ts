import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  AttendanceSheetDto,
  GradebookDto,
  GradingPeriodDto,
  RegionalOverviewDto,
  SchoolFollowUpDto,
  StudentDetailDto,
  TeacherClassDto,
} from "@escolar/shared";
import { addDays } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let ana: TestUser; // titular de Matemáticas 1A
let beto: TestUser; // sustituto
let ceci: TestUser; // da clases en 1B, no en 1A
let secretary: TestUser;
let math1A: AssignmentDto;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
let periods: GradingPeriodDto[];
const kids: string[] = [];
const schoolId = randomUUID();
const TODAY = "2026-11-09";

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  ana = await ctx.user("docente", schoolId, "Ana Titular");
  beto = await ctx.user("docente", schoolId, "Beto Sustituto");
  ceci = await ctx.user("docente", schoolId, "Ceci Docente");
  secretary = await ctx.user("secretaria", schoolId, "Sofía");
  structure = await ctx.seedStructure(director);
  math1A = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: structure.sectionA.id,
      subjectId: structure.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  await ctx.call(director, "POST", "/assignments", {
    sectionId: structure.sectionB.id,
    subjectId: structure.subject.id,
    teacherUserId: ceci.id,
  });
  for (const name of ["Ana", "Beto", "Carla"]) {
    const s = await ctx.call<StudentDetailDto>(director, "POST", "/students", {
      firstNames: name,
      lastNames: "Alumno",
      guardians: [guardian()],
      sectionId: structure.sectionA.id,
    });
    kids.push(s.body.id);
  }
  periods = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body.periods;
});
afterAll(() => ctx.close());

const current = () => periods[3] as GradingPeriodDto;
const putActivity = (who: TestUser, body: Record<string, unknown>) =>
  ctx.call(who, "PUT", `/activities/${body.id}`, {
    assignmentId: math1A.id,
    periodId: current().id,
    date: TODAY,
    ...body,
  });
const putScores = (
  who: TestUser,
  activityId: string,
  entries: Array<{ studentId: string; points: number | null }>,
) => ctx.call<{ error?: { message: string } }>(who, "PUT", "/scores", { activityId, entries });
const book = (who: TestUser) => ctx.call<GradebookDto>(who, "GET", `/gradebook/${math1A.id}`);

describe("parciales", () => {
  it("cada año lectivo trae cuatro parciales y el vigente es el IV", async () => {
    const res = await ctx.call<{ periods: GradingPeriodDto[]; current: string; passingGrade: number }>(
      director,
      "GET",
      "/periods",
    );
    expect(res.body.periods.map((p) => p.name)).toEqual([
      "I Parcial",
      "II Parcial",
      "III Parcial",
      "IV Parcial",
    ]);
    expect(res.body.current).toBe(current().id);
    expect(res.body.passingGrade).toBe(70);
  });

  it("valida que los parciales estén dentro del año", async () => {
    const shifted = periods.map((p) => ({ ...p, endsOn: p.endsOn, closesOn: addDays(p.endsOn, 7) }));
    shifted[0] = { ...shifted[0]!, startsOn: "2026-01-01" };
    expect((await ctx.call(director, "PUT", "/periods", { periods: shifted })).status).toBe(400);
  });
});

describe("cuaderno de notas", () => {
  const tarea = randomUUID();
  const examen = randomUUID();

  it("el maestro ve sus clases con sus alumnos", async () => {
    const res = await ctx.call<TeacherClassDto[]>(ana, "GET", "/teacher/classes");
    expect(res.body).toMatchObject([{ assignment: { id: math1A.id }, substituting: false, students: 3 }]);
  });

  it("crear la misma actividad dos veces (reintento sin internet) no la duplica", async () => {
    expect((await putActivity(ana, { id: tarea, name: "Tarea 1", maxPoints: 20 })).status).toBe(200);
    expect((await putActivity(ana, { id: tarea, name: "Tarea 1", maxPoints: 20 })).status).toBe(200);
    expect((await putActivity(ana, { id: examen, name: "Examen", maxPoints: 30 })).status).toBe(200);
    expect((await book(ana)).body.activities.map((a) => a.name)).toEqual(["Tarea 1", "Examen"]);
  });

  it("calcula la nota acumulada, la proyección y marca a quien va reprobando", async () => {
    await putScores(ana, tarea, [
      { studentId: kids[0]!, points: 18 },
      { studentId: kids[1]!, points: 8 },
      { studentId: kids[2]!, points: null },
    ]);
    await putScores(ana, examen, [
      { studentId: kids[0]!, points: 27.5 },
      { studentId: kids[1]!, points: 12 },
    ]);
    const res = (await book(ana)).body;
    expect(res.possible).toBe(50);
    const [first, second, third] = res.students;
    expect(first).toMatchObject({ points: 45.5, projected: 91, grade: null, atRisk: false });
    expect(second).toMatchObject({ points: 20, projected: 40, atRisk: true });
    expect(third).toMatchObject({ points: 0, missing: 2 });
  });

  it("no acepta notas mayores al valor ni alumnos de otra sección", async () => {
    expect((await putScores(ana, tarea, [{ studentId: kids[0]!, points: 21 }])).status).toBe(400);
    expect((await putScores(ana, tarea, [{ studentId: randomUUID(), points: 5 }])).status).toBe(400);
  });

  it("no deja bajar el valor de una actividad por debajo de notas ya puestas", async () => {
    const res = await putActivity(ana, { id: tarea, name: "Tarea 1", maxPoints: 10 });
    expect(res.status).toBe(409);
  });

  it("un maestro que no da la clase no la ve ni la califica", async () => {
    expect((await book(ceci)).status).toBe(404);
    expect((await putScores(ceci, tarea, [{ studentId: kids[0]!, points: 5 }])).status).toBe(403);
    expect((await putActivity(ceci, { id: randomUUID(), name: "Intrusa", maxPoints: 5 })).status).toBe(403);
  });

  it("el sustituto califica solo mientras dura su sustitución", async () => {
    const leave = await ctx.call<{ id: string }>(director, "POST", "/leaves", {
      teacherUserId: ana.id,
      type: "enfermedad",
      startsOn: TODAY,
      endsOn: addDays(TODAY, 2),
    });
    await ctx.call(director, "POST", `/leaves/${leave.body.id}/substitutions`, {
      assignmentId: math1A.id,
      substituteUserId: beto.id,
    });
    const classes = (await ctx.call<TeacherClassDto[]>(beto, "GET", "/teacher/classes")).body;
    expect(classes).toMatchObject([{ assignment: { id: math1A.id }, substituting: true }]);
    expect((await putScores(beto, tarea, [{ studentId: kids[2]!, points: 15 }])).status).toBe(200);

    ctx.setToday(addDays(TODAY, 5)); // terminó la licencia
    expect((await putScores(beto, tarea, [{ studentId: kids[2]!, points: 16 }])).status).toBe(403);
    expect((await putScores(ana, tarea, [{ studentId: kids[2]!, points: 16 }])).status).toBe(200);
    ctx.setToday(TODAY);
  });

  it("borrar una actividad borra sus notas; borrarla otra vez no es error", async () => {
    const extra = randomUUID();
    await putActivity(ana, { id: extra, name: "Borrable", maxPoints: 5 });
    await putScores(ana, extra, [{ studentId: kids[0]!, points: 5 }]);
    expect((await ctx.call(ana, "DELETE", `/activities/${extra}`)).status).toBe(204);
    expect((await ctx.call(ana, "DELETE", `/activities/${extra}`)).status).toBe(204);
    expect((await book(ana)).body.activities.map((a) => a.id)).not.toContain(extra);
  });

  it("otro centro no toca estas notas", async () => {
    const other = await ctx.user("admin", randomUUID());
    expect((await ctx.call(other, "GET", `/gradebook/${math1A.id}`)).status).toBe(404);
    expect((await putScores(other, tarea, [{ studentId: kids[0]!, points: 1 }])).status).toBe(404);
  });
});

describe("asistencia", () => {
  const sheet = (who: TestUser, date = TODAY) =>
    ctx.call<AttendanceSheetDto>(who, "GET", `/attendance/${structure.sectionA.id}?fecha=${date}`);
  const take = (who: TestUser, date: string, statuses: string[]) =>
    ctx.call(who, "PUT", "/attendance", {
      sectionId: structure.sectionA.id,
      date,
      entries: kids.map((studentId, i) => ({ studentId, status: statuses[i] })),
    });

  it("el maestro de la sección toma asistencia; registrar dos veces actualiza", async () => {
    expect((await take(ana, TODAY, ["presente", "ausente", "tarde"])).status).toBe(200);
    expect((await take(ana, TODAY, ["presente", "ausente", "justificada"])).status).toBe(200);
    expect((await sheet(ana)).body.totals).toEqual({
      presente: 1,
      ausente: 1,
      tarde: 0,
      justificada: 1,
      sin_registro: 0,
    });
  });

  it("no se registra un día futuro ni fuera del año", async () => {
    expect((await take(ana, addDays(TODAY, 1), ["presente", "presente", "presente"])).status).toBe(400);
    expect((await take(director, "2026-01-15", ["presente", "presente", "presente"])).status).toBe(400);
  });

  it("quien no da clases en la sección no toma asistencia; secretaría sí", async () => {
    expect((await take(ceci, TODAY, ["presente", "presente", "presente"])).status).toBe(403);
    expect((await sheet(ceci)).status).toBe(404);
    expect((await take(secretary, TODAY, ["presente", "ausente", "presente"])).status).toBe(200);
  });
});

describe("seguimiento y alerta temprana", () => {
  it("detecta alumnos en riesgo por faltas y por notas, antes del cierre", async () => {
    // Beto falta 5 días seguidos
    for (let d = 1; d <= 5; d++) {
      await ctx.call(director, "PUT", "/attendance", {
        sectionId: structure.sectionA.id,
        date: addDays(TODAY, -d),
        entries: kids.map((studentId, i) => ({ studentId, status: i === 1 ? "ausente" : "presente" })),
      });
    }
    const res = await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up");
    expect(res.body.period?.name).toBe("IV Parcial");
    expect(res.body.daysToClose).toBe(25);
    const beto = res.body.studentsAtRisk.find((s) => s.studentId === kids[1]);
    expect(beto?.absences).toBeGreaterThanOrEqual(5);
    expect(beto?.failing).toEqual([{ subjectName: "Matemáticas", projected: 40 }]);
    expect(res.body.studentsAtRisk.map((s) => s.studentId)).not.toContain(kids[0]);
    expect(res.body.attendance.sectionsRecordedToday).toBe(1);
  });

  it("una clase está completa cuando repartió 100 puntos y todos tienen nota", async () => {
    const before = (await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up")).body;
    expect(before.gradeProgress).toMatchObject({ complete: 0, total: 2 });

    const final = randomUUID();
    await putActivity(ana, { id: final, name: "Examen final", maxPoints: 50 });
    for (const activity of (await book(ana)).body.activities) {
      await putScores(
        ana,
        activity.id,
        kids.map((studentId) => ({ studentId, points: activity.maxPoints / 2 })),
      );
    }
    const after = (await ctx.call<SchoolFollowUpDto>(director, "GET", "/follow-up")).body;
    expect(after.gradeProgress.items.find((i) => i.assignment.id === math1A.id)).toMatchObject({
      complete: true,
      possible: 100,
      studentsComplete: 3,
    });
  });

  it("el cuadro de calificaciones da la nota del parcial por materia", async () => {
    const res = await ctx.call<{ students: Array<{ grades: Record<string, { grade: number | null }> }> }>(
      director,
      "GET",
      `/sections/${structure.sectionA.id}/grades-report`,
    );
    expect(res.body.students.map((s) => s.grades[math1A.id]?.grade)).toEqual([50, 50, 50]);
  });

  it("la departamental ve asistencia, alumnos en riesgo y si el centro va atrasado con las notas", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [
      { id: schoolId, name: "Escuela" },
    ]);
    const now = (await ctx.call<RegionalOverviewDto>(departmental, "GET", "/regional/overview")).body;
    const school = now.schools[0];
    expect(school?.studentsAtRisk).toBeGreaterThan(0);
    expect(school?.attendanceRate7d).not.toBeNull();
    expect(school).toMatchObject({
      periodName: "IV Parcial",
      gradeProgress: { complete: 1, total: 2 },
      behindOnGrades: false,
    });

    // A una semana del cierre, con una clase incompleta: atrasado
    const late = (
      await ctx.call<RegionalOverviewDto>(departmental, "GET", "/regional/overview?fecha=2026-11-30")
    ).body;
    expect(late.schools[0]?.behindOnGrades).toBe(true);
    expect(late.totals.schoolsBehindOnGrades).toBe(1);
  });
});
