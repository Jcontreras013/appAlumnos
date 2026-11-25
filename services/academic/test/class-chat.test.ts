import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  ClassChatDto,
  ClassChatMessageDto,
  ClassroomDto,
  PortalAccessDto,
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
let luisUser: TestUser;
let sofiaUser: TestUser;
let pedroUser: TestUser; // otra sección
let mother: TestUser;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
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
  const luis = await create("Luis", s.sectionA.id, "0801201105555", "0801198501234");
  const sofia = await create("Sofía", s.sectionA.id, "0801201106666");
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
});
afterAll(() => ctx.close());

const chat = (who: TestUser) => ctx.call<ClassChatDto>(who, "GET", `/classes/${math1A.id}/chat`);
const say = (who: TestUser, body: string) =>
  ctx.call<ClassChatMessageDto>(who, "POST", `/classes/${math1A.id}/chat`, { body });

describe("chat de la clase", () => {
  it("viene cerrado: nadie escribe hasta que la maestra lo abre", async () => {
    expect((await chat(luisUser)).body).toMatchObject({ enabled: false, canWrite: false, messages: [] });
    expect((await say(luisUser, "Hola")).status).toBe(409);
    expect(
      (await ctx.call(luisUser, "PUT", `/classes/${math1A.id}/chat/estado`, { enabled: true })).status,
    ).toBe(403);
    const open = await ctx.call(ana, "PUT", `/classes/${math1A.id}/chat/estado`, { enabled: true });
    expect(open.status).toBe(200);
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.body.chatEnabled).toBe(true);
  });

  it("la maestra y los alumnos de la sección conversan; cada uno ve cuáles son suyos", async () => {
    expect((await say(ana, "Buenos días, ¿dudas de la tarea?")).status).toBe(201);
    const luis = await say(luisUser, "Profe, ¿el ejercicio 5 es para mañana?");
    expect(luis.body).toMatchObject({ authorName: "Luis López", authorRole: "alumno", mine: true });
    expect((await say(luisUser, "   ")).status).toBe(400);
    const seen = await chat(sofiaUser);
    expect(seen.body.canWrite).toBe(true);
    expect(seen.body.canModerate).toBe(false);
    expect(seen.body.messages.map((m) => [m.authorRole, m.mine])).toEqual([
      ["maestro", false],
      ["alumno", false],
    ]);
    // Solo lo nuevo, para que la pantalla se actualice sin traer todo otra vez.
    const since = seen.body.messages[0]?.createdAt as string;
    const newer = await ctx.call<ClassChatDto>(
      sofiaUser,
      "GET",
      `/classes/${math1A.id}/chat?despues=${encodeURIComponent(since)}`,
    );
    expect(newer.body.messages).toHaveLength(1);
  });

  it("otra sección y las familias no lo ven; la dirección lo lee y modera, pero no escribe", async () => {
    expect((await chat(pedroUser)).status).toBe(404);
    expect((await chat(mother)).status).toBe(403);
    const office = await chat(director);
    expect(office.body).toMatchObject({ canWrite: false, canModerate: true });
    expect((await say(director, "Hola")).status).toBe(403);
  });

  it("cada alumno borra lo suyo; la maestra borra cualquiera y queda «borrado»", async () => {
    const sofia = await say(sofiaUser, "mensaje fuera de lugar");
    const luisMsg = (await chat(luisUser)).body.messages.find((m) => m.mine);
    expect((await ctx.call(luisUser, "DELETE", `/class-chat/${sofia.body.id}`)).status).toBe(403);
    expect((await ctx.call(luisUser, "DELETE", `/class-chat/${luisMsg?.id}`)).status).toBe(204);
    expect((await ctx.call(ana, "DELETE", `/class-chat/${sofia.body.id}`)).status).toBe(204);
    const after = await chat(ana);
    expect(after.body.messages.filter((m) => m.body === null)).toHaveLength(2);
  });

  it("al cerrarlo ya no se escribe, pero se sigue leyendo", async () => {
    await ctx.call(ana, "PUT", `/classes/${math1A.id}/chat/estado`, { enabled: false });
    expect((await say(luisUser, "¿Sigue abierto?")).status).toBe(409);
    expect((await say(ana, "Cerrado por hoy")).status).toBe(409);
    expect((await chat(luisUser)).body.messages.length).toBeGreaterThan(0);
  });
});
