import { randomUUID } from "node:crypto";
import type { AnnouncementDto, PortalAccessDto, StudentDetailDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

/** Avisos del centro: quién los publica, quién los ve y cuándo vencen. */

const TODAY = "2026-11-09";
let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let teacher: TestUser;
let mom: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: TODAY });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Secretaria Paz");
  teacher = await ctx.user("docente", schoolId);
  structure = await ctx.seedStructure(director);
  const kid = (
    await ctx.call<StudentDetailDto>(director, "POST", "/students", {
      firstNames: "Luis",
      lastNames: "Alumno",
      guardians: [guardian({ nationalId: "0801198000001" })],
      sectionId: structure.sectionA.id,
    })
  ).body;
  const access = await ctx.call<PortalAccessDto>(
    secretary,
    "POST",
    `/guardians/${kid.guardians[0]?.id}/portal-access`,
    {},
  );
  mom = await ctx.user("padre", schoolId, "Mamá de Luis", access.body.userId);
});
afterAll(() => ctx.close());

const publish = (who: TestUser, body: object) =>
  ctx.call<AnnouncementDto & { error?: { message: string } }>(who, "POST", "/announcements", body);
const titles = async (who: TestUser, url = "/announcements") =>
  (await ctx.call<AnnouncementDto[]>(who, "GET", url)).body.map((a) => a.title);

describe("avisos del centro", () => {
  it("la secretaría publica; vence en 30 días si no se dice", async () => {
    const res = await publish(secretary, {
      title: "Entrega de boletas",
      body: "El viernes a las 8:00 am.",
      audience: "todos",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      authorName: "Secretaria Paz",
      expiresOn: "2026-12-09",
      sectionLabel: null,
    });
    await publish(director, { title: "Consejo de maestros", body: "Lunes 2 pm.", audience: "personal" });
    await publish(director, {
      title: "Excursión de Primer grado B",
      body: "Traer permiso firmado.",
      audience: "familias",
      sectionId: structure.sectionB.id,
    });
    await publish(director, {
      title: "Reunión de Primer grado A",
      body: "Jueves 3 pm.",
      audience: "familias",
      sectionId: structure.sectionA.id,
      expiresOn: "2026-11-12",
    });
  });

  it("cada quien ve lo suyo: docentes lo del personal, familias lo de su hijo", async () => {
    expect((await titles(teacher)).sort()).toEqual(["Consejo de maestros", "Entrega de boletas"]);
    expect((await titles(mom, "/family/announcements")).sort()).toEqual([
      "Entrega de boletas",
      "Reunión de Primer grado A",
    ]);
    expect(await titles(director)).toHaveLength(4);
  });

  it("los vencidos ya no se muestran a familias ni docentes", async () => {
    ctx.setToday("2026-11-13");
    expect(await titles(mom, "/family/announcements")).toEqual(["Entrega de boletas"]);
    expect(await titles(director)).toContain("Reunión de Primer grado A");
    ctx.setToday(TODAY);
  });

  it("valida y protege: docentes y familias no publican; solo autor o dirección quitan", async () => {
    expect((await publish(director, { title: "", body: "x", audience: "todos" })).status).toBe(400);
    expect(
      (
        await publish(director, {
          title: "Viejo",
          body: "Ya pasó",
          audience: "todos",
          expiresOn: "2026-11-01",
        })
      ).status,
    ).toBe(400);
    expect((await publish(teacher, { title: "Hola", body: "Aviso", audience: "todos" })).status).toBe(403);
    expect((await ctx.call(mom, "GET", "/announcements")).status).toBe(403);

    const all = (await ctx.call<AnnouncementDto[]>(secretary, "GET", "/announcements")).body;
    const fromDirector = all.find((a) => a.title === "Consejo de maestros") as AnnouncementDto;
    const fromSecretary = all.find((a) => a.title === "Entrega de boletas") as AnnouncementDto;
    expect((await ctx.call(secretary, "DELETE", `/announcements/${fromDirector.id}`)).status).toBe(403);
    expect((await ctx.call(director, "DELETE", `/announcements/${fromSecretary.id}`)).status).toBe(204);

    const other = await ctx.user("admin", randomUUID());
    expect(await titles(other)).toEqual([]);
    expect((await ctx.call(other, "DELETE", `/announcements/${fromDirector.id}`)).status).toBe(404);
    expect(
      (
        await publish(other, {
          title: "Intruso",
          body: "x x x",
          audience: "todos",
          sectionId: structure.sectionA.id,
        })
      ).status,
    ).toBe(404);
  });
});
