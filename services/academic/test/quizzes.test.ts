import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  ClassQuizDetailDto,
  ClassQuizDto,
  ClassroomDto,
  GradebookDto,
  GradingPeriodDto,
  PortalAccessDto,
  QuizAttemptDto,
  QuizQuestionDto,
  StudentAccessDto,
  StudentDetailDto,
} from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quizAttempts } from "../src/db/schema";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser;
let math1A: AssignmentDto;
let luis: StudentDetailDto;
let sofia: StudentDetailDto;
let luisUser: TestUser;
let sofiaUser: TestUser;
let pedroUser: TestUser;
let mother: TestUser;
let iv: GradingPeriodDto;
const schoolId = randomUUID();
const TODAY = "2026-11-09";
const OPEN = { opensDate: "2020-01-01", opensTime: "00:00", closesDate: "2030-01-01", closesTime: "23:59" };

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  const beto = await ctx.user("docente", schoolId, "Beto Maestro");
  const s = await ctx.seedStructure(director);
  math1A = (
    await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
      sectionId: s.sectionA.id,
      subjectId: s.subject.id,
      teacherUserId: ana.id,
    })
  ).body;
  await ctx.call(director, "POST", "/assignments", {
    sectionId: s.sectionB.id,
    subjectId: s.subject.id,
    teacherUserId: beto.id,
  });
  const create = async (firstNames: string, sectionId: string, nationalId: string, mom?: string) =>
    (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames,
        lastNames: "López",
        nationalId,
        guardians: [guardian(mom ? { nationalId: mom } : {})],
        sectionId,
      })
    ).body;
  luis = await create("Luis", s.sectionA.id, "0801201105555", "0801198501234");
  sofia = await create("Sofía", s.sectionA.id, "0801201106666");
  const pedro = await create("Pedro", s.sectionB.id, "0801201107777");
  const account = async (st: StudentDetailDto, name: string) =>
    ctx.user(
      "estudiante",
      schoolId,
      name,
      (await ctx.call<StudentAccessDto>(secretary, "POST", `/students/${st.id}/student-access`, {})).body
        .userId,
    );
  luisUser = await account(luis, "Luis López");
  sofiaUser = await account(sofia, "Sofía López");
  pedroUser = await account(pedro, "Pedro López");
  const mom = (
    await ctx.call<PortalAccessDto>(
      secretary,
      "POST",
      `/guardians/${luis.guardians[0]?.id}/portal-access`,
      {},
    )
  ).body;
  mother = await ctx.user("padre", schoolId, "María López", mom.userId);
  const periods = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body.periods;
  iv = periods[3] as GradingPeriodDto;
});
afterAll(() => ctx.close());

describe("exámenes en línea", () => {
  let quiz: ClassQuizDto;
  let multiple: QuizQuestionDto;
  let trueFalse: QuizQuestionDto;
  let open: QuizQuestionDto;

  it("la maestra arma un examen de 20 puntos con tres tipos de pregunta", async () => {
    const res = await ctx.call<ClassQuizDto>(ana, "POST", `/classes/${math1A.id}/quizzes`, {
      title: "Prueba corta de fracciones",
      instructions: "Tienes 30 minutos.",
      ...OPEN,
      timeLimitMinutes: 30,
      points: 20,
      periodId: iv.id,
    });
    expect(res.status).toBe(201);
    quiz = res.body;
    expect(quiz).toMatchObject({ published: false, points: 20, questionCount: 0 });

    const add = (payload: object) =>
      ctx.call<QuizQuestionDto>(ana, "POST", `/class-quizzes/${quiz.id}/questions`, payload);
    multiple = (
      await add({
        kind: "opcion",
        prompt: "¿Cuánto es 2 + 2?",
        options: ["3", "4", "5"],
        correct: 1,
        points: 2,
      })
    ).body;
    trueFalse = (await add({ kind: "vf", prompt: "1/2 es igual a 2/4", correct: true, points: 2 })).body;
    open = (await add({ kind: "abierta", prompt: "Explica qué son fracciones equivalentes.", points: 6 }))
      .body;
    expect(multiple.correct).toBe(1);

    const bad = await add({
      kind: "opcion",
      prompt: "Sin opciones",
      options: ["solo una"],
      correct: 0,
      points: 1,
    });
    expect(bad.status).toBe(400);
    const noAnswer = await add({ kind: "vf", prompt: "Sin respuesta", points: 1 });
    expect(noAnswer.status).toBe(400);
  });

  it("mientras es borrador, el alumno no lo ve", async () => {
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.quizzes).toEqual([]);
    expect((await ctx.call(luisUser, "GET", `/class-quizzes/${quiz.id}`)).status).toBe(404);
  });

  it("publicado: el alumno lo ve disponible y las preguntas aparecen al empezar, sin respuestas", async () => {
    const pub = await ctx.call<ClassQuizDto>(ana, "POST", `/class-quizzes/${quiz.id}/publish`, {
      published: true,
    });
    expect(pub.body.published).toBe(true);
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.quizzes[0]).toMatchObject({ status: "disponible", questionCount: 3, rawPoints: 10 });

    const before = await ctx.call<ClassQuizDetailDto>(luisUser, "GET", `/class-quizzes/${quiz.id}`);
    expect(before.body.questions).toEqual([]);
    expect((await ctx.call(luisUser, "POST", `/class-quizzes/${quiz.id}/start`)).status).toBe(200);
    const during = await ctx.call<ClassQuizDetailDto>(luisUser, "GET", `/class-quizzes/${quiz.id}`);
    expect(during.body.questions).toHaveLength(3);
    expect(during.body.questions.every((q) => q.correct === null)).toBe(true);
    expect(during.body.mine?.status).toBe("en_curso");
  });

  it("con un alumno adentro, las preguntas ya no se cambian", async () => {
    const add = await ctx.call(ana, "POST", `/class-quizzes/${quiz.id}/questions`, {
      kind: "vf",
      prompt: "Otra",
      correct: false,
      points: 1,
    });
    expect(add.status).toBe(409);
    expect((await ctx.call(ana, "DELETE", `/quiz-questions/${open.id}`)).status).toBe(409);
  });

  it("el alumno responde y entrega: las cerradas se califican solas, la abierta espera", async () => {
    const wrongType = await ctx.call(luisUser, "PUT", `/class-quizzes/${quiz.id}/answers`, {
      answers: { [trueFalse.id]: "verdadero" },
    });
    expect(wrongType.status).toBe(400);
    await ctx.call(luisUser, "PUT", `/class-quizzes/${quiz.id}/answers`, { answers: { [multiple.id]: 1 } });
    const sent = await ctx.call<QuizAttemptDto>(luisUser, "PUT", `/class-quizzes/${quiz.id}/answers`, {
      answers: {
        [trueFalse.id]: false,
        [open.id]: "Son las que valen lo mismo aunque se escriban distinto.",
      },
      finish: true,
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: "entregado", pendingReview: true, rawScore: 2, score: null });
    const again = await ctx.call(luisUser, "PUT", `/class-quizzes/${quiz.id}/answers`, {
      answers: { [trueFalse.id]: true },
    });
    expect(again.status).toBe(409);
  });

  it("la maestra revisa la abierta: la nota llevada a 20 puntos cae en la libreta", async () => {
    const detail = await ctx.call<ClassQuizDetailDto>(ana, "GET", `/class-quizzes/${quiz.id}`);
    const row = detail.body.attempts?.find((a) => a.studentId === luis.id);
    expect(row).toMatchObject({ status: "entregado", pendingReview: true });
    expect(detail.body.questions.find((q) => q.id === multiple.id)?.correct).toBe(1);

    const tooMuch = await ctx.call(ana, "PUT", `/class-quizzes/${quiz.id}/attempts/${luis.id}/review`, {
      points: { [open.id]: 7 },
    });
    expect(tooMuch.status).toBe(400);
    const reviewed = await ctx.call<QuizAttemptDto>(
      ana,
      "PUT",
      `/class-quizzes/${quiz.id}/attempts/${luis.id}/review`,
      { points: { [open.id]: 5 } },
    );
    // 2 (selección) + 0 (V/F) + 5 (abierta) = 7 de 10 → 14 de 20.
    expect(reviewed.body).toMatchObject({
      status: "calificado",
      rawScore: 7,
      score: 14,
      pendingReview: false,
    });
    const book = await ctx.call<GradebookDto>(ana, "GET", `/gradebook/${math1A.id}?periodId=${iv.id}`);
    const activityId = book.body.activities.find((a) => a.name === "Prueba corta de fracciones")
      ?.id as string;
    expect(book.body.students.find((s) => s.studentId === luis.id)?.scores[activityId]).toBe(14);
  });

  it("el alumno y su familia ven la nota; las respuestas correctas, hasta que cierre", async () => {
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.quizzes[0]).toMatchObject({ status: "calificado", myScore: 14 });
    const detail = await ctx.call<ClassQuizDetailDto>(mother, "GET", `/class-quizzes/${quiz.id}`);
    expect(detail.body.mine).toMatchObject({ status: "calificado", score: 14 });
    expect(detail.body.questions.every((q) => q.correct === null)).toBe(true);
    expect((await ctx.call(pedroUser, "GET", `/class-quizzes/${quiz.id}`)).status).toBe(404);
  });

  it("la maestra comenta en qué falló cada pregunta y deja un comentario general; el alumno lo ve", async () => {
    const res = await ctx.call<QuizAttemptDto>(
      ana,
      "PUT",
      `/class-quizzes/${quiz.id}/attempts/${luis.id}/review`,
      {
        comments: { [trueFalse.id]: "Revisa: 2/4 y 1/2 sí son equivalentes.", [multiple.id]: "" },
        feedback: "Buen trabajo, Luis. Repasa la simplificación.",
      },
    );
    expect(res.status).toBe(200);
    // Sin puntos nuevos, la nota no cambia.
    expect(res.body).toMatchObject({ score: 14, feedback: "Buen trabajo, Luis. Repasa la simplificación." });
    expect(res.body.answers.find((a) => a.questionId === trueFalse.id)?.comment).toBe(
      "Revisa: 2/4 y 1/2 sí son equivalentes.",
    );
    const seen = await ctx.call<ClassQuizDetailDto>(luisUser, "GET", `/class-quizzes/${quiz.id}`);
    expect(seen.body.mine?.feedback).toBe("Buen trabajo, Luis. Repasa la simplificación.");
    expect(seen.body.mine?.answers.find((a) => a.questionId === trueFalse.id)?.comment).toContain(
      "equivalentes",
    );
    // Un comentario vacío lo quita; una pregunta de otro examen no se acepta.
    const cleared = await ctx.call<QuizAttemptDto>(
      ana,
      "PUT",
      `/class-quizzes/${quiz.id}/attempts/${luis.id}/review`,
      {
        comments: { [trueFalse.id]: "" },
      },
    );
    expect(cleared.body.answers.find((a) => a.questionId === trueFalse.id)?.comment).toBeNull();
    expect(cleared.body.feedback).toBe("Buen trabajo, Luis. Repasa la simplificación.");
    const foreign = await ctx.call(ana, "PUT", `/class-quizzes/${quiz.id}/attempts/${luis.id}/review`, {
      comments: { "00000000-0000-4000-8000-000000000000": "x" },
    });
    expect(foreign.status).toBe(400);
  });

  it("si se acaba el tiempo, el examen se entrega solo con lo que alcanzó a responder", async () => {
    await ctx.call(sofiaUser, "POST", `/class-quizzes/${quiz.id}/start`);
    await ctx.call(sofiaUser, "PUT", `/class-quizzes/${quiz.id}/answers`, {
      answers: { [multiple.id]: 1, [trueFalse.id]: true },
    });
    // Se le acabaron los 30 minutos.
    await ctx.db
      .update(quizAttempts)
      .set({ deadline: new Date(Date.now() - 5 * 60_000) })
      .where(eq(quizAttempts.studentId, sofia.id));
    const detail = await ctx.call<ClassQuizDetailDto>(ana, "GET", `/class-quizzes/${quiz.id}`);
    const row = detail.body.attempts?.find((a) => a.studentId === sofia.id);
    // La abierta quedó en blanco: vale 0 y no hay nada que revisar.
    expect(row).toMatchObject({ status: "calificado", rawScore: 4, score: 8 });
    const late = await ctx.call(sofiaUser, "PUT", `/class-quizzes/${quiz.id}/answers`, {
      answers: { [open.id]: "tarde" },
      finish: true,
    });
    expect(late.status).toBe(409);
  });

  it("un examen cerrado no se empieza; uno sin preguntas no se publica", async () => {
    const closed = (
      await ctx.call<ClassQuizDto>(ana, "POST", `/classes/${math1A.id}/quizzes`, {
        title: "Examen del año pasado",
        opensDate: "2020-01-01",
        opensTime: "08:00",
        closesDate: "2020-01-01",
        closesTime: "10:00",
      })
    ).body;
    expect(
      (await ctx.call(ana, "POST", `/class-quizzes/${closed.id}/publish`, { published: true })).status,
    ).toBe(400);
    await ctx.call(ana, "POST", `/class-quizzes/${closed.id}/questions`, {
      kind: "vf",
      prompt: "¿Sí?",
      correct: true,
      points: 1,
    });
    await ctx.call(ana, "POST", `/class-quizzes/${closed.id}/publish`, { published: true });
    expect((await ctx.call(luisUser, "POST", `/class-quizzes/${closed.id}/start`)).status).toBe(409);
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.quizzes.find((q) => q.id === closed.id)?.status).toBe("cerrado");
    const bad = await ctx.call(ana, "POST", `/classes/${math1A.id}/quizzes`, {
      title: "Al revés",
      opensDate: "2030-01-02",
      opensTime: "08:00",
      closesDate: "2030-01-01",
      closesTime: "10:00",
    });
    expect(bad.status).toBe(400);
  });

  it("sin abiertas, la nota sale al entregar", async () => {
    const quick = (
      await ctx.call<ClassQuizDto>(ana, "POST", `/classes/${math1A.id}/quizzes`, {
        title: "Repaso rápido",
        ...OPEN,
      })
    ).body;
    const q = (
      await ctx.call<QuizQuestionDto>(ana, "POST", `/class-quizzes/${quick.id}/questions`, {
        kind: "vf",
        prompt: "3/6 = 1/2",
        correct: true,
        points: 5,
      })
    ).body;
    await ctx.call(ana, "POST", `/class-quizzes/${quick.id}/publish`, { published: true });
    await ctx.call(luisUser, "POST", `/class-quizzes/${quick.id}/start`);
    const done = await ctx.call<QuizAttemptDto>(luisUser, "PUT", `/class-quizzes/${quick.id}/answers`, {
      answers: { [q.id]: true },
      finish: true,
    });
    expect(done.body).toMatchObject({ status: "calificado", rawScore: 5, score: 5 });
  });

  it("borrar el examen borra su columna de la libreta", async () => {
    expect((await ctx.call(ana, "DELETE", `/class-quizzes/${quiz.id}`)).status).toBe(204);
    const book = await ctx.call<GradebookDto>(ana, "GET", `/gradebook/${math1A.id}?periodId=${iv.id}`);
    expect(book.body.activities.some((a) => a.name === "Prueba corta de fracciones")).toBe(false);
  });
});
