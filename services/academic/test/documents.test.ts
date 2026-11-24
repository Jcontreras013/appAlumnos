import { randomUUID } from "node:crypto";
import { type DocumentDto, type DocumentSummaryDto, documentTemplate } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

/** Documentos del centro: circulares, actas e informes escritos en CONECTA. */

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let ana: TestUser;
let outsider: TestUser;
const schoolId = randomUUID();
const acta = documentTemplate("acta", {
  schoolName: "Escuela Demo",
  date: "2026-11-21",
  authorName: "Sofía Secretaria",
});

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-21" });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Prof. Ana");
  outsider = await ctx.user("admin", randomUUID(), "Otro centro");
});
afterAll(() => ctx.close());

describe("documentos", () => {
  let id: string;
  let version: number;

  it("la secretaría crea un acta desde la plantilla; empieza privada", async () => {
    const res = await ctx.call<DocumentDto>(secretary, "POST", "/documents", {
      title: acta.title,
      template: "acta",
      content: acta.content,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Acta de reunión",
      visibility: "privado",
      mine: true,
      canEdit: true,
    });
    id = res.body.id;
    version = res.body.version;
    // Privado: nadie más lo ve, ni la dirección.
    expect((await ctx.call(director, "GET", `/documents/${id}`)).status).toBe(404);
    const list = await ctx.call<DocumentSummaryDto[]>(ana, "GET", "/documents");
    expect(list.body.map((d) => d.id)).not.toContain(id);
  });

  it("al compartirlo con el personal lo ven todos, pero solo la autora lo cambia", async () => {
    const saved = await ctx.call<DocumentDto>(secretary, "PUT", `/documents/${id}`, {
      title: "Acta de reunión de padres",
      content: acta.content,
      visibility: "personal",
      version,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(version + 1);
    version = saved.body.version;

    const seen = await ctx.call<DocumentDto>(ana, "GET", `/documents/${id}`);
    expect(seen.body).toMatchObject({ title: "Acta de reunión de padres", canEdit: false, mine: false });
    expect(seen.body.content.content.filter((n) => n.type === "table")).toHaveLength(2);
    const edit = await ctx.call(ana, "PUT", `/documents/${id}`, {
      title: "Cambiado",
      content: acta.content,
      visibility: "personal",
      version,
    });
    expect(edit.status).toBe(404);
    expect((await ctx.call(ana, "DELETE", `/documents/${id}`)).status).toBe(404);
    expect((await ctx.call(outsider, "GET", `/documents/${id}`)).status).toBe(404);
  });

  it("si otra ventana guardó antes, no se pisa lo guardado", async () => {
    const stale = await ctx.call<{ error: { message: string } }>(secretary, "PUT", `/documents/${id}`, {
      title: "Desde la ventana vieja",
      content: acta.content,
      visibility: "personal",
      version: version - 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/otra ventana/);
  });

  it("no guarda contenido que el editor no ofrece", async () => {
    const res = await ctx.call(secretary, "PUT", `/documents/${id}`, {
      title: "Con imagen",
      content: { type: "doc", content: [{ type: "image", attrs: { src: "https://ejemplo.com/x.png" } }] },
      visibility: "personal",
      version,
    });
    expect(res.status).toBe(400);
  });

  it("un documento nuevo sin contenido empieza en blanco", async () => {
    const res = await ctx.call<DocumentDto>(ana, "POST", "/documents", { title: "Notas de la semana" });
    expect(res.body.content).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(res.body.template).toBe("blanco");
  });

  it("la autora lo borra y queda en la bitácora", async () => {
    expect((await ctx.call(secretary, "DELETE", `/documents/${id}`)).status).toBe(204);
    expect((await ctx.call(secretary, "GET", `/documents/${id}`)).status).toBe(404);
    const log = await ctx.call<Array<{ action: string }>>(director, "GET", "/audit");
    expect(log.body.map((e) => e.action)).toContain("document.deleted");
  });
});
