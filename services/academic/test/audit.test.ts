import { randomUUID } from "node:crypto";
import type { AuditEventDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic();
  director = await ctx.user("admin", schoolId, "Directora");
  const s = await ctx.seedStructure(director);
  await ctx.call(director, "PUT", `/grades/${s.grade.id}`, { name: "1er grado", sortOrder: 1 });
  await ctx.call(director, "PUT", `/subjects/${s.subject.id}`, { name: "Matemática" });
});
afterAll(() => ctx.close());

describe("bitácora del centro", () => {
  it("la dirección la ve de la más reciente a la más antigua, por páginas", async () => {
    const first = (await ctx.call<AuditEventDto[]>(director, "GET", "/audit?limite=2")).body;
    expect(first.map((e) => e.action)).toEqual(["subject.updated", "grade.updated"]);
    expect(first[0]).toMatchObject({
      source: "academic",
      actorUserId: director.id,
      data: { name: "Matemática" },
    });
    const next = (
      await ctx.call<AuditEventDto[]>(director, "GET", `/audit?limite=50&antes=${first.at(-1)?.createdAt}`)
    ).body;
    expect(next.map((e) => e.action)).toContain("school_year.created");
    expect(next.some((e) => e.action === "grade.updated")).toBe(false);
  });

  it("solo la dirección, y solo lo de su centro", async () => {
    expect((await ctx.call(await ctx.user("coordinador", schoolId), "GET", "/audit")).status).toBe(403);
    expect((await ctx.call(director, "GET", "/audit?antes=ayer")).status).toBe(400);
    const other = await ctx.user("admin", randomUUID());
    expect((await ctx.call<AuditEventDto[]>(other, "GET", "/audit")).body).toEqual([]);
  });
});
