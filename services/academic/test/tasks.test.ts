import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  ClassroomDto,
  ClassTaskDetailDto,
  ClassTaskDto,
  GradebookDto,
  GradingPeriodDto,
  PortalAccessDto,
  StudentAccessDto,
  StudentDetailDto,
  TaskSubmissionDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser;
let beto: TestUser;
let math1A: AssignmentDto;
let luis: StudentDetailDto;
let sofia: StudentDetailDto;
let luisUser: TestUser;
let sofiaUser: TestUser;
let pedroUser: TestUser; // otra sección
let mother: TestUser;
let periods: GradingPeriodDto[];
const schoolId = randomUUID();
const TODAY = "2026-11-09";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(800, 65), Buffer.from("\n%%EOF")]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(900, 7),
  Buffer.from([0xff, 0xd9]),
]);

const raw = (who: TestUser, url: string, body: Buffer, name: string) =>
  ctx.app
    .inject({
      method: "POST",
      url,
      headers: {
        authorization: `Bearer ${who.token}`,
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(name),
      },
      payload: body,
    })
    .then((res) => ({
      status: res.statusCode,
      body: res.json() as { id: string; error?: { message: string } },
    }));
const fileGet = (who: TestUser, id: string) =>
  ctx.app.inject({
    method: "GET",
    url: `/task-files/${id}/file`,
    headers: { authorization: `Bearer ${who.token}` },
  });

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  beto = await ctx.user("docente", schoolId, "Beto Maestro");
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
  periods = (await ctx.call<{ periods: GradingPeriodDto[] }>(director, "GET", "/periods")).body.periods;
});
afterAll(() => ctx.close());

describe("tareas con entrega", () => {
  let task: ClassTaskDto;
  let luisFile: string;

  it("la maestra publica una tarea de 20 puntos: aparece sola en su libreta", async () => {
    const iv = periods[3] as GradingPeriodDto;
    const res = await ctx.call<ClassTaskDto>(ana, "POST", `/classes/${math1A.id}/tasks`, {
      title: "Ejercicios de fracciones",
      instructions: "Resuelve la página 45, ejercicios 1 al 10. Sube una foto de tu cuaderno.",
      dueDate: "2030-01-15",
      dueTime: "18:00",
      allowLate: false,
      points: 20,
      periodId: iv.id,
    });
    expect(res.status).toBe(201);
    task = res.body;
    expect(task).toMatchObject({ points: 20, periodName: iv.name, dueTime: "18:00", allowLate: false });
    expect(task.stats).toEqual({ total: 2, submitted: 0, graded: 0 });
    const book = await ctx.call<GradebookDto>(ana, "GET", `/gradebook/${math1A.id}?periodId=${iv.id}`);
    expect(book.body.activities.map((a) => [a.name, a.maxPoints])).toEqual([
      ["Ejercicios de fracciones", 20],
    ]);

    const attach = await raw(ana, `/class-tasks/${task.id}/files`, PDF, "hoja de trabajo.pdf");
    expect(attach.status).toBe(201);
  });

  it("respeta los 100 puntos del parcial y pide el parcial si lleva nota", async () => {
    const iv = periods[3] as GradingPeriodDto;
    const tooMuch = await ctx.call(ana, "POST", `/classes/${math1A.id}/tasks`, {
      title: "Proyecto",
      dueDate: "2030-01-20",
      points: 90,
      periodId: iv.id,
    });
    expect(tooMuch.status).toBe(409);
    const noPeriod = await ctx.call(ana, "POST", `/classes/${math1A.id}/tasks`, {
      title: "Proyecto",
      dueDate: "2030-01-20",
      points: 10,
    });
    expect(noPeriod.status).toBe(400);
  });

  it("el alumno la ve pendiente, sube una foto y la entrega", async () => {
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.tasks.map((t) => [t.title, t.status])).toEqual([
      ["Ejercicios de fracciones", "pendiente"],
    ]);
    expect(room.body.tasks[0]?.attachments.map((a) => a.name)).toEqual(["hoja de trabajo.pdf"]);

    const empty = await ctx.call(luisUser, "PUT", `/class-tasks/${task.id}/submission`, {
      text: "",
      turnIn: true,
    });
    expect(empty.status).toBe(400);

    const up = await raw(luisUser, `/class-tasks/${task.id}/submission/files`, JPEG, "cuaderno.jpg");
    expect(up.status).toBe(201);
    luisFile = up.body.id;
    const sent = await ctx.call<TaskSubmissionDto>(luisUser, "PUT", `/class-tasks/${task.id}/submission`, {
      text: "Aquí va mi tarea.",
      turnIn: true,
    });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ status: "entregada", late: false, text: "Aquí va mi tarea." });
    expect(sent.body.files.map((f) => f.name)).toEqual(["cuaderno.jpg"]);
  });

  it("entregada ya no se cambia, salvo que anule la entrega", async () => {
    const more = await raw(luisUser, `/class-tasks/${task.id}/submission/files`, JPEG, "otra.jpg");
    expect(more.status).toBe(409);
    const undo = await ctx.call<TaskSubmissionDto>(luisUser, "PUT", `/class-tasks/${task.id}/submission`, {
      text: "Aquí va mi tarea.",
      turnIn: false,
    });
    expect(undo.body.status).toBe("borrador");
    const again = await ctx.call<TaskSubmissionDto>(luisUser, "PUT", `/class-tasks/${task.id}/submission`, {
      text: "Aquí va mi tarea (corregida).",
      turnIn: true,
    });
    expect(again.body.status).toBe("entregada");
  });

  it("su familia la ve; otra alumna y otra sección no ven su archivo ni la tarea", async () => {
    const detail = await ctx.call<ClassTaskDetailDto>(mother, "GET", `/class-tasks/${task.id}`);
    expect(detail.body.mine?.status).toBe("entregada");
    expect((await fileGet(mother, luisFile)).statusCode).toBe(200);
    expect((await fileGet(sofiaUser, luisFile)).statusCode).toBe(404);
    expect((await ctx.call(pedroUser, "GET", `/class-tasks/${task.id}`)).status).toBe(404);
    expect((await ctx.call(beto, "GET", `/class-tasks/${task.id}`)).status).toBe(404);
  });

  it("la maestra ve la lista de la sección con lo entregado y califica; la nota cae en la libreta", async () => {
    const detail = await ctx.call<ClassTaskDetailDto>(ana, "GET", `/class-tasks/${task.id}`);
    expect(detail.body.submissions?.map((s) => [s.studentName, s.status])).toEqual([
      ["López, Luis", "entregada"],
      ["López, Sofía", "pendiente"],
    ]);
    expect((await fileGet(ana, luisFile)).statusCode).toBe(200);

    const tooHigh = await ctx.call(ana, "PUT", `/class-tasks/${task.id}/grades/${luis.id}`, { points: 25 });
    expect(tooHigh.status).toBe(400);
    const graded = await ctx.call<TaskSubmissionDto>(
      ana,
      "PUT",
      `/class-tasks/${task.id}/grades/${luis.id}`,
      {
        points: 18,
        feedback: "Muy bien, revisa el ejercicio 7.",
      },
    );
    expect(graded.body).toMatchObject({ status: "calificada", points: 18 });
    // Sofía la entregó en papel: también se le puede poner nota.
    await ctx.call(ana, "PUT", `/class-tasks/${task.id}/grades/${sofia.id}`, { points: 15 });

    const iv = periods[3] as GradingPeriodDto;
    const book = await ctx.call<GradebookDto>(ana, "GET", `/gradebook/${math1A.id}?periodId=${iv.id}`);
    const activityId = book.body.activities[0]?.id as string;
    const row = (id: string) => book.body.students.find((s) => s.studentId === id)?.scores[activityId];
    expect(row(luis.id)).toBe(18);
    expect(row(sofia.id)).toBe(15);
  });

  it("el alumno ve su nota y el comentario, y ya no puede cambiar la entrega", async () => {
    const detail = await ctx.call<ClassTaskDetailDto>(luisUser, "GET", `/class-tasks/${task.id}`);
    expect(detail.body).toMatchObject({ canSubmit: false });
    expect(detail.body.mine).toMatchObject({
      status: "calificada",
      points: 18,
      feedback: "Muy bien, revisa el ejercicio 7.",
    });
    const change = await ctx.call(luisUser, "PUT", `/class-tasks/${task.id}/submission`, {
      text: "otra",
      turnIn: true,
    });
    expect(change.status).toBe(409);
  });

  it("si la maestra cambia la nota en el cuaderno, el alumno ve la del cuaderno", async () => {
    const iv = periods[3] as GradingPeriodDto;
    const book = await ctx.call<GradebookDto>(ana, "GET", `/gradebook/${math1A.id}?periodId=${iv.id}`);
    const activityId = book.body.activities[0]?.id as string;
    await ctx.call(ana, "PUT", "/scores", { activityId, entries: [{ studentId: luis.id, points: 19 }] });
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.tasks[0]).toMatchObject({ status: "calificada", myPoints: 19 });
  });

  it("fuera de fecha: la que no acepta tarde se cierra; la que sí, queda marcada tarde", async () => {
    const closedTask = (
      await ctx.call<ClassTaskDto>(ana, "POST", `/classes/${math1A.id}/tasks`, {
        title: "Lectura de ayer",
        dueDate: "2020-01-10",
        allowLate: false,
      })
    ).body;
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.tasks.find((t) => t.id === closedTask.id)?.status).toBe("vencida");
    const late = await ctx.call(luisUser, "PUT", `/class-tasks/${closedTask.id}/submission`, {
      text: "tarde",
      turnIn: true,
    });
    expect(late.status).toBe(409);

    const lenient = (
      await ctx.call<ClassTaskDto>(ana, "POST", `/classes/${math1A.id}/tasks`, {
        title: "Resumen",
        dueDate: "2020-01-10",
        allowLate: true,
      })
    ).body;
    const sent = await ctx.call<TaskSubmissionDto>(luisUser, "PUT", `/class-tasks/${lenient.id}/submission`, {
      text: "Mi resumen",
      turnIn: true,
    });
    expect(sent.body).toMatchObject({ status: "tarde", late: true });
  });

  it("en primaria la familia entrega por el alumno, y la maestra lo ve", async () => {
    const homework = (
      await ctx.call<ClassTaskDto>(ana, "POST", `/classes/${math1A.id}/tasks`, {
        title: "Dibujo de fracciones",
        dueDate: "2030-02-01",
        allowLate: true,
      })
    ).body;
    const byMom = await ctx.call<TaskSubmissionDto>(mother, "PUT", `/class-tasks/${homework.id}/submission`, {
      text: "Lo hizo en una cartulina; se la manda mañana.",
      turnIn: true,
    });
    expect(byMom.body.status).toBe("entregada");
    const detail = await ctx.call<ClassTaskDetailDto>(ana, "GET", `/class-tasks/${homework.id}`);
    const row = detail.body.submissions?.find((x) => x.studentId === luis.id);
    expect(row).toMatchObject({ submittedByOther: true, submittedByName: "María López" });
  });

  it("borrar la tarea borra su columna de la libreta y sus archivos", async () => {
    expect((await ctx.call(ana, "DELETE", `/class-tasks/${task.id}`)).status).toBe(204);
    const iv = periods[3] as GradingPeriodDto;
    const book = await ctx.call<GradebookDto>(ana, "GET", `/gradebook/${math1A.id}?periodId=${iv.id}`);
    expect(book.body.activities).toEqual([]);
    expect((await fileGet(ana, luisFile)).statusCode).toBe(404);
  });
});
