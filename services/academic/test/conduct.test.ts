import { randomUUID } from "node:crypto";
import type {
  AssignmentDto,
  AttendanceSheetDto,
  AuditEventDto,
  ConductActaDto,
  ConductIncidentDto,
  ConductOverviewDto,
  ConductStudentOptionDto,
  FamilyChildDto,
  PortalAccessDto,
  RegionalSchoolDetailDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Conducta: incidentes que reporta el personal y medidas que decide el centro. */

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let director: TestUser;
let coordinator: TestUser;
let secretary: TestUser;
let teacher: TestUser;
let otherTeacher: TestUser;
let luis: StudentDetailDto;
let ana: StudentDetailDto;
let sectionA: string;
const school = { id: randomUUID(), name: "Escuela Demo West End", districtName: "Roatán" };
const schoolId = school.id;

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora Ruiz");
  coordinator = await ctx.user("coordinador", schoolId, "Coordinadora Paz");
  secretary = await ctx.user("secretaria", schoolId);
  teacher = await ctx.user("docente", schoolId, "Prof. Britney Mejía");
  otherTeacher = await ctx.user("docente", schoolId, "Prof. Héctor Cruz");
  const s = await ctx.seedStructure(director);
  sectionA = s.sectionA.id;
  await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
    sectionId: s.sectionA.id,
    subjectId: s.subject.id,
    teacherUserId: teacher.id,
  });
  await ctx.call<AssignmentDto>(director, "POST", "/assignments", {
    sectionId: s.sectionB.id,
    subjectId: s.subject.id,
    teacherUserId: otherTeacher.id,
  });
  luis = (
    await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
      firstNames: "Luis",
      lastNames: "López",
      guardians: [guardian({ nationalId: "0801-1985-01234" })],
      sectionId: s.sectionA.id,
    })
  ).body;
  ana = (
    await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
      firstNames: "Ana",
      lastNames: "Cruz",
      guardians: [guardian({ fullName: "Rosa Cruz", phone: "9911-2233" })],
      sectionId: s.sectionB.id,
    })
  ).body;
});
afterAll(() => ctx.close());

const report = (who: TestUser, body: Record<string, unknown>) =>
  ctx.call<ConductIncidentDto>(who, "POST", "/conduct/incidents", {
    date: TODAY,
    severity: "grave",
    category: "agresion",
    description: "Empujó a un compañero en el recreo y lo hizo caer.",
    ...body,
  });
const measure = (who: TestUser, incidentId: string, body: Record<string, unknown>) =>
  ctx.call<ConductIncidentDto>(who, "POST", `/conduct/incidents/${incidentId}/measures`, {
    startsOn: TODAY,
    notes: "Se conversó con el alumno y se informó a la familia.",
    ...body,
  });

describe("reportar incidentes", () => {
  it("el maestro reporta a un alumno de su sección, no a uno de otra sección", async () => {
    const ok = await report(teacher, { studentId: luis.id });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      studentId: luis.id,
      studentName: "López, Luis",
      severity: "grave",
      reportedByName: "Prof. Britney Mejía",
      measures: [],
      canDelete: true,
    });
    expect((await report(teacher, { studentId: ana.id })).status).toBe(404);
    const options = await ctx.call<ConductStudentOptionDto[]>(teacher, "GET", "/conduct/students");
    expect(options.body.map((o) => o.studentId)).toEqual([luis.id]);
  });

  it("valida la fecha y la descripción; la secretaría no reporta", async () => {
    expect((await report(teacher, { studentId: luis.id, date: "2026-11-10" })).status).toBe(400);
    expect((await report(teacher, { studentId: luis.id, description: "Corto" })).status).toBe(400);
    expect((await report(secretary, { studentId: luis.id })).status).toBe(403);
  });

  it("el maestro ve solo lo que reportó; la oficina ve todo", async () => {
    await report(otherTeacher, { studentId: ana.id, severity: "leve", category: "objetos" });
    const mine = await ctx.call<ConductOverviewDto>(teacher, "GET", "/conduct");
    expect(mine.body.incidents.every((i) => i.reportedByName === "Prof. Britney Mejía")).toBe(true);
    expect(mine.body.can).toEqual({ report: true, measure: false, suspendOrExpel: false });
    const office = await ctx.call<ConductOverviewDto>(secretary, "GET", "/conduct");
    expect(office.body.incidents.map((i) => i.studentId).sort()).toEqual([ana.id, luis.id].sort());
    expect(office.body.can).toEqual({ report: false, measure: false, suspendOrExpel: false });
  });

  it("quien lo reportó lo borra si no tiene medidas; otro maestro no", async () => {
    const created = (await report(teacher, { studentId: luis.id, severity: "leve", category: "otra" })).body;
    expect((await ctx.call(otherTeacher, "DELETE", `/conduct/incidents/${created.id}`)).status).toBe(403);
    expect((await ctx.call(teacher, "DELETE", `/conduct/incidents/${created.id}`)).status).toBe(204);
  });
});

describe("medidas", () => {
  let incident: ConductIncidentDto;
  beforeAll(async () => {
    incident = (await report(teacher, { studentId: luis.id, severity: "muy_grave" })).body;
  });

  it("la coordinación cita a la familia; la suspensión y la expulsión son solo de la dirección", async () => {
    const citation = await measure(coordinator, incident.id, { kind: "citacion_familia" });
    expect(citation.status).toBe(201);
    expect(citation.body.measures.map((m) => m.kind)).toEqual(["citacion_familia"]);
    expect(
      (await measure(coordinator, incident.id, { kind: "suspension", endsOn: "2026-11-11" })).status,
    ).toBe(403);
    expect((await measure(coordinator, incident.id, { kind: "expulsion" })).status).toBe(403);
    expect((await measure(teacher, incident.id, { kind: "llamado_atencion" })).status).toBe(403);
  });

  it("la suspensión necesita su último día y dura como máximo 30 días", async () => {
    expect((await measure(director, incident.id, { kind: "suspension" })).status).toBe(400);
    expect((await measure(director, incident.id, { kind: "suspension", endsOn: "2026-12-09" })).status).toBe(
      400,
    );
    const ok = await measure(director, incident.id, { kind: "suspension", endsOn: "2026-11-11" });
    expect(ok.status).toBe(201);
    const overview = await ctx.call<ConductOverviewDto>(director, "GET", "/conduct");
    expect(overview.body.totals.activeSuspensions).toBe(1);
  });

  it("mientras dura la suspensión, el alumno aparece marcado en la lista de asistencia", async () => {
    const sheet = async (date: string) =>
      (await ctx.call<AttendanceSheetDto>(teacher, "GET", `/attendance/${sectionA}?fecha=${date}`)).body;
    const today = await sheet(TODAY);
    expect(today.students.find((x) => x.studentId === luis.id)?.suspendedUntil).toBe("2026-11-11");
    const before = await sheet("2026-11-06");
    expect(before.students.find((x) => x.studentId === luis.id)?.suspendedUntil).toBeNull();
  });

  it("en el llamado de atención se elige si se avisa a la familia; lo demás siempre se avisa", async () => {
    const quiet = await measure(coordinator, incident.id, {
      kind: "llamado_atencion",
      notes: "Se habló con él en privado.",
    });
    expect(quiet.status).toBe(201);
    const told = await measure(coordinator, incident.id, {
      kind: "llamado_atencion",
      notes: "Se le recordó la norma de convivencia.",
      notifyFamily: "on",
    });
    const warnings = told.body.measures.filter((m) => m.kind === "llamado_atencion");
    expect(warnings.map((m) => m.notifyFamily).sort()).toEqual([false, true]);
    expect(told.body.measures.find((m) => m.kind === "citacion_familia")?.notifyFamily).toBe(true);
  });

  it("el acta de una medida trae al alumno y a su encargado; el maestro solo la de sus reportes", async () => {
    const suspension = (
      await ctx.call<ConductIncidentDto[]>(director, "GET", `/students/${luis.id}/conduct`)
    ).body
      .flatMap((i) => i.measures)
      .find((m) => m.kind === "suspension");
    if (!suspension) throw new Error("falta la suspensión");
    const url = `/conduct/measures/${suspension.id}/acta`;
    const acta = await ctx.call<ConductActaDto>(secretary, "GET", url);
    expect(acta.status).toBe(200);
    expect(acta.body).toMatchObject({
      measure: { id: suspension.id, kind: "suspension", endsOn: "2026-11-11" },
      incident: { id: incident.id, studentName: "López, Luis" },
    });
    expect(acta.body.guardianName).toEqual(expect.any(String));
    expect((await ctx.call(teacher, "GET", url)).status).toBe(200);
    expect((await ctx.call(otherTeacher, "GET", url)).status).toBe(404);
  });

  it("un incidente con medidas ya no se borra", async () => {
    expect((await ctx.call(director, "DELETE", `/conduct/incidents/${incident.id}`)).status).toBe(400);
  });

  it("la familia ve las medidas, pero no la descripción del incidente", async () => {
    const access = (
      await ctx.call<PortalAccessDto>(
        secretary,
        "POST",
        `/guardians/${luis.guardians[0]?.id}/portal-access`,
        {},
      )
    ).body;
    const mom = await ctx.user("padre", schoolId, "María López Castro", access.userId);
    const child = (await ctx.call<FamilyChildDto>(mom, "GET", `/family/children/${luis.id}`)).body;
    // El llamado que no se le avisó no aparece.
    expect(child.conduct.map((c) => c.kind).sort()).toEqual([
      "citacion_familia",
      "llamado_atencion",
      "suspension",
    ]);
    expect(child.conduct[0]).toMatchObject({ severity: "muy_grave", category: "agresion" });
    expect(JSON.stringify(child.conduct)).not.toContain("Empujó");
    expect(JSON.stringify(child.conduct)).not.toContain("en privado");
  });

  it("la expulsión retira la matrícula en la misma operación", async () => {
    expect((await measure(director, incident.id, { kind: "expulsion", startsOn: "2026-11-10" })).status).toBe(
      400,
    );
    const res = await measure(director, incident.id, { kind: "expulsion", notes: "Por agresión reiterada." });
    expect(res.status).toBe(201);
    const detail = (await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${luis.id}`)).body;
    expect(detail.enrollments[0]).toMatchObject({ status: "retirada", withdrawnOn: TODAY });
    expect(detail.enrollments[0]?.withdrawReason).toBe("Expulsión: Por agresión reiterada.");

    // Sin matrícula activa no se puede expulsar otra vez, y no queda una medida a medias.
    expect((await measure(director, incident.id, { kind: "expulsion" })).status).toBe(400);
    const history = await ctx.call<ConductIncidentDto[]>(secretary, "GET", `/students/${luis.id}/conduct`);
    const kinds = history.body.flatMap((i) => i.measures.map((m) => m.kind));
    expect(kinds.filter((k) => k === "expulsion")).toHaveLength(1);
  });

  it("solo la dirección anula una medida, y queda en el historial como anulada", async () => {
    const citation = (
      await ctx.call<ConductIncidentDto[]>(director, "GET", `/students/${luis.id}/conduct`)
    ).body
      .flatMap((i) => i.measures)
      .find((m) => m.kind === "citacion_familia");
    if (!citation) throw new Error("falta la citación");
    expect((await ctx.call(coordinator, "POST", `/conduct/measures/${citation.id}/cancel`)).status).toBe(403);
    const ok = await ctx.call<ConductIncidentDto>(
      director,
      "POST",
      `/conduct/measures/${citation.id}/cancel`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.measures.find((m) => m.id === citation.id)?.cancelledAt).not.toBeNull();
    expect((await ctx.call(director, "POST", `/conduct/measures/${citation.id}/cancel`)).status).toBe(404);
  });

  it("todo queda en la bitácora", async () => {
    const log = (await ctx.call<AuditEventDto[]>(director, "GET", "/audit?limite=50")).body.map(
      (e) => e.action,
    );
    expect(log).toEqual(
      expect.arrayContaining([
        "conduct.incident_reported",
        "conduct.incident_deleted",
        "conduct.measure_added",
        "conduct.measure_cancelled",
        "enrollment.withdrawn",
      ]),
    );
  });

  it("la departamental ve cuántos casos hay y las suspensiones y expulsiones, sin descripciones", async () => {
    const departmental = await ctx.regionalUser("director_departamental", [school]);
    const detail = (
      await ctx.call<RegionalSchoolDetailDto>(departmental, "GET", `/regional/schools/${schoolId}`)
    ).body;
    expect(detail.conduct).toMatchObject({ suspensions: 1, expulsions: 1 });
    expect(detail.conduct.measures.map((m) => m.studentName)).toEqual(["López, Luis", "López, Luis"]);
    expect(JSON.stringify(detail.conduct)).not.toContain("Empujó");
  });
});
