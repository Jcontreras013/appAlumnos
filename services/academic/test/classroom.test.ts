import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  ClassMaterialDto,
  ClassPostDto,
  ClassroomDto,
  ClassSummaryDto,
  PortalAccessDto,
  StudentAccessDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser; // Matemáticas 1A
let beto: TestUser; // Matemáticas 1B
let math1A: AssignmentDto;
let math1B: AssignmentDto;
let luisUser: TestUser; // alumno de 1A
let pedroUser: TestUser; // alumno de 1B
let mother: TestUser; // madre de Luis
let luis: StudentDetailDto;
const schoolId = randomUUID();
const TODAY = "2026-11-09";
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1000, 65), Buffer.from("\n%%EOF")]);

const upload = (who: TestUser, postId: string, body: Buffer, name: string, titulo = "") =>
  ctx.app
    .inject({
      method: "POST",
      url: `/class-posts/${postId}/files?${new URLSearchParams(titulo ? { titulo } : {})}`,
      headers: {
        authorization: `Bearer ${who.token}`,
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(name),
      },
      payload: body,
    })
    .then((res) => ({ status: res.statusCode, body: res.json() as ClassMaterialDto }));

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  beto = await ctx.user("docente", schoolId, "Beto Maestro");
  const s = await ctx.seedStructure(director);
  const assign = async (sectionId: string, teacher: TestUser) =>
    (
      await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
        sectionId,
        subjectId: s.subject.id,
        teacherUserId: teacher.id,
      })
    ).body;
  math1A = await assign(s.sectionA.id, ana);
  math1B = await assign(s.sectionB.id, beto);
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
  const pedro = await create("Pedro", s.sectionB.id, "0801201107777");
  const account = async (student: StudentDetailDto) =>
    (await ctx.call<StudentAccessDto>(secretary, "POST", `/students/${student.id}/student-access`, {})).body;
  luisUser = await ctx.user("estudiante", schoolId, "Luis López", (await account(luis)).userId);
  pedroUser = await ctx.user("estudiante", schoolId, "Pedro López", (await account(pedro)).userId);
  const momAccess = (
    await ctx.call<PortalAccessDto>(
      secretary,
      "POST",
      `/guardians/${luis.guardians[0]?.id}/portal-access`,
      {},
    )
  ).body;
  mother = await ctx.user("padre", schoolId, "María López", momAccess.userId);
});
afterAll(() => ctx.close());

describe("aula virtual de una clase", () => {
  let fracciones: ClassPostDto;
  let pdf: ClassMaterialDto;

  it("la maestra publica un tema con su explicación, un video de YouTube, un enlace y un PDF", async () => {
    const res = await ctx.call<ClassPostDto>(ana, "POST", `/classes/${math1A.id}/posts`, {
      kind: "tema",
      title: "Unidad 3: Fracciones equivalentes",
      body: "Dos fracciones son equivalentes si representan la misma parte del todo.",
    });
    expect(res.status).toBe(201);
    fracciones = res.body;

    const video = await ctx.call<ClassMaterialDto>(ana, "POST", `/class-posts/${fracciones.id}/links`, {
      title: "Explicación en video",
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(video.body).toMatchObject({ kind: "video", youtubeId: "dQw4w9WgXcQ" });
    const link = await ctx.call<ClassMaterialDto>(ana, "POST", `/class-posts/${fracciones.id}/links`, {
      url: "https://www.educatrachos.hn/fracciones",
    });
    expect(link.body).toMatchObject({ kind: "enlace", title: "educatrachos.hn", youtubeId: null });

    const up = await upload(ana, fracciones.id, PDF, "Guía de fracciones.pdf");
    expect(up.status).toBe(201);
    pdf = up.body;
    expect(pdf).toMatchObject({ kind: "archivo", title: "Guía de fracciones" });
    expect(pdf.file).toMatchObject({ contentType: "application/pdf", size: PDF.length });
  });

  it("no acepta programas ni archivos que no son lo que dicen", async () => {
    expect((await upload(ana, fracciones.id, PDF, "virus.exe")).status).toBe(415);
    const fake = await upload(ana, fracciones.id, Buffer.from("no soy un pdf, solo texto"), "falso.pdf");
    expect(fake.status).toBe(415);
  });

  it("avisos y enlace de la clase en línea", async () => {
    await ctx.call(ana, "POST", `/classes/${math1A.id}/posts`, {
      kind: "aviso",
      title: "Mañana hay prueba corta",
      body: "Traigan calculadora.",
    });
    const settings = await ctx.call(ana, "PUT", `/classes/${math1A.id}/settings`, {
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      meetingNote: "Martes y jueves, 3:00 p. m.",
    });
    expect(settings.status).toBe(200);
    const bad = await ctx.call(ana, "PUT", `/classes/${math1A.id}/settings`, { meetingUrl: "http://zoom" });
    expect(bad.status).toBe(400);
  });

  it("el alumno ve sus clases y la página de la clase, y abre el PDF", async () => {
    const mine = await ctx.call<ClassSummaryDto[]>(luisUser, "GET", "/classes");
    expect(mine.body.map((c) => c.subjectName)).toEqual(["Matemáticas"]);
    expect(mine.body[0]).toMatchObject({
      assignmentId: math1A.id,
      topics: 1,
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });
    const room = await ctx.call<ClassroomDto>(luisUser, "GET", `/classes/${math1A.id}`);
    expect(room.status).toBe(200);
    expect(room.body).toMatchObject({ viewer: "alumno", canEdit: false, teacherName: "Ana Maestra" });
    expect(room.body.topics[0]?.materials.map((m) => m.kind)).toEqual(["video", "enlace", "archivo"]);
    expect(room.body.announcements.map((a) => a.title)).toEqual(["Mañana hay prueba corta"]);
    const file = await ctx.app.inject({
      method: "GET",
      url: `/class-materials/${pdf.id}/file`,
      headers: { authorization: `Bearer ${luisUser.token}` },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-disposition"]).toMatch(/^inline/);
    expect(file.rawPayload.equals(PDF)).toBe(true);
  });

  it("el alumno no publica nada", async () => {
    const post = await ctx.call(luisUser, "POST", `/classes/${math1A.id}/posts`, {
      kind: "aviso",
      title: "Hola",
      body: "",
    });
    expect(post.status).toBe(404);
    expect((await ctx.call(luisUser, "DELETE", `/class-materials/${pdf.id}`)).status).toBe(404);
  });

  it("un alumno de otra sección no ve la clase ni sus archivos", async () => {
    expect((await ctx.call(pedroUser, "GET", `/classes/${math1A.id}`)).status).toBe(404);
    const file = await ctx.app.inject({
      method: "GET",
      url: `/class-materials/${pdf.id}/file`,
      headers: { authorization: `Bearer ${pedroUser.token}` },
    });
    expect(file.statusCode).toBe(404);
    const his = await ctx.call<ClassSummaryDto[]>(pedroUser, "GET", "/classes");
    expect(his.body.map((c) => c.assignmentId)).toEqual([math1B.id]);
  });

  it("la familia ve las clases de su hijo (y solo de su hijo)", async () => {
    const list = await ctx.call<ClassSummaryDto[]>(mother, "GET", `/classes?alumno=${luis.id}`);
    expect(list.body.map((c) => c.assignmentId)).toEqual([math1A.id]);
    const room = await ctx.call<ClassroomDto>(mother, "GET", `/classes/${math1A.id}`);
    expect(room.body.viewer).toBe("familia");
    expect((await ctx.call(mother, "GET", `/classes/${math1B.id}`)).status).toBe(404);
  });

  it("otro maestro no edita la clase; la dirección sí; la secretaría solo la ve", async () => {
    expect((await ctx.call(beto, "GET", `/classes/${math1A.id}`)).status).toBe(404);
    const room = await ctx.call<ClassroomDto>(director, "GET", `/classes/${math1A.id}`);
    expect(room.body.canEdit).toBe(true);
    const office = await ctx.call<ClassroomDto>(secretary, "GET", `/classes/${math1A.id}`);
    expect(office.body).toMatchObject({ viewer: "oficina", canEdit: false });
    const all = await ctx.call<ClassSummaryDto[]>(secretary, "GET", "/classes?todas=1");
    expect(all.body).toHaveLength(2);
  });

  it("la maestra ordena los temas y al borrar uno se van sus archivos", async () => {
    const second = (
      await ctx.call<ClassPostDto>(ana, "POST", `/classes/${math1A.id}/posts`, {
        kind: "tema",
        title: "Unidad 2: Números decimales",
        body: "",
      })
    ).body;
    const order = await ctx.call(ana, "PUT", `/classes/${math1A.id}/topics/order`, {
      ids: [second.id, fracciones.id],
    });
    expect(order.status).toBe(200);
    const room = await ctx.call<ClassroomDto>(ana, "GET", `/classes/${math1A.id}`);
    expect(room.body.topics.map((t) => t.title)).toEqual([
      "Unidad 2: Números decimales",
      "Unidad 3: Fracciones equivalentes",
    ]);

    expect((await ctx.call(ana, "DELETE", `/class-posts/${fracciones.id}`)).status).toBe(204);
    const file = await ctx.app.inject({
      method: "GET",
      url: `/class-materials/${pdf.id}/file`,
      headers: { authorization: `Bearer ${ana.token}` },
    });
    expect(file.statusCode).toBe(404);
  });
});
