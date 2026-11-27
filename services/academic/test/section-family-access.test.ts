import { randomUUID } from "node:crypto";
import type { SectionFamilyAccessDto, StudentDetailDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let secretary: TestUser;
let ana: TestUser;
let sectionA: string;
let sectionB: string;
let luis: StudentDetailDto;
const schoolId = randomUUID();
const MOM = "0801198501234";
const DAD = "0801198305678";

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
  const director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  ana = await ctx.user("docente", schoolId, "Ana Maestra");
  const s = await ctx.seedStructure(director);
  sectionA = s.sectionA.id;
  sectionB = s.sectionB.id;
  const create = async (
    firstNames: string,
    guardians: Array<Record<string, unknown>>,
    sectionId = sectionA,
  ) =>
    (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames,
        lastNames: "López",
        guardians,
        sectionId,
      })
    ).body;
  // Luis y Sofía: hermanos, la misma madre (principal); Luis también tiene al papá registrado.
  luis = await create("Luis", [
    guardian({ nationalId: MOM, isPrimary: true }),
    guardian({ fullName: "José López Díaz", relationship: "padre", nationalId: DAD }),
  ]);
  await create("Sofía", [guardian({ nationalId: MOM })]);
  // Pedro: su encargado no tiene identidad ni correo.
  await create("Pedro", [guardian({ fullName: "Carlos Pérez", phone: "9911-2233" })]);
  // Marta: la encargada solo tiene correo.
  await create("Marta", [guardian({ fullName: "Rosa Mejía", email: "rosa@example.com" })]);
  // Otra sección: no se toca.
  await create("Iris", [guardian({ fullName: "Elena Cruz", nationalId: "0801199009999" })], sectionB);
});

afterAll(() => ctx.close());

describe("acceso al portal para toda una sección", () => {
  it("crea uno por familia (los hermanos comparten) y avisa de los que no tienen con qué entrar", async () => {
    const res = await ctx.call<SectionFamilyAccessDto>(
      secretary,
      "POST",
      `/sections/${sectionA}/portal-access`,
      {},
    );
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.created.map((c) => [c.guardianName, c]));
    expect(Object.keys(byName).sort()).toEqual(["María López Castro", "Rosa Mejía"]);
    expect(byName["María López Castro"]?.children.sort()).toEqual(["Luis López", "Sofía López"]);
    expect(byName["María López Castro"]?.temporaryPassword).toBeTruthy();
    expect(byName["Rosa Mejía"]?.login).toBe("rosa@example.com");
    expect(res.body.alreadyActive).toBe(0);
    expect(res.body.interrupted).toBeNull();
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ studentName: "Pedro López", guardianName: "Carlos Pérez" }),
    ]);

    const detail = await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${luis.id}`);
    const mom = detail.body.guardians.find((g) => g.nationalId === MOM);
    const dad = detail.body.guardians.find((g) => g.nationalId === DAD);
    expect(mom?.hasPortalAccess).toBe(true);
    expect(dad?.hasPortalAccess).toBe(false); // no es el principal
  });

  it("la segunda vez solo crea las que faltan; con la casilla, también a los demás encargados", async () => {
    const again = await ctx.call<SectionFamilyAccessDto>(
      secretary,
      "POST",
      `/sections/${sectionA}/portal-access`,
      {},
    );
    expect(again.body.created).toEqual([]);
    expect(again.body.alreadyActive).toBe(2);

    const all = await ctx.call<SectionFamilyAccessDto>(
      secretary,
      "POST",
      `/sections/${sectionA}/portal-access`,
      {
        allGuardians: true,
      },
    );
    expect(all.body.created.map((c) => c.guardianName)).toEqual(["José López Díaz"]);
    expect(all.body.alreadyActive).toBe(2);
  });

  it("no toca otras secciones ni lo puede hacer un maestro", async () => {
    expect((await ctx.call(ana, "POST", `/sections/${sectionA}/portal-access`, {})).status).toBe(403);
    const other = await ctx.call<SectionFamilyAccessDto>(
      secretary,
      "POST",
      `/sections/${sectionB}/portal-access`,
      {},
    );
    expect(other.body.created.map((c) => c.guardianName)).toEqual(["Elena Cruz"]);
  });
});
