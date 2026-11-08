import { randomUUID } from "node:crypto";
import type { ImportResultDto, StudentDetailDto, StudentListItemDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AcademicTestContext, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let secretary: TestUser;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic();
  const admin = await ctx.user("admin", schoolId);
  secretary = await ctx.user("secretaria", schoolId);
  await ctx.seedStructure(admin, { capacityA: 3 });
});
afterAll(() => ctx.close());

const row = (overrides: Record<string, string> = {}) => ({
  nombres: "Ana",
  apellidos: "López",
  grado: "Primer Grado", // mayúsculas distintas a propósito
  seccion: "a",
  responsable: "María López",
  parentesco: "Mamá",
  telefono: "9988-7766",
  ...overrides,
});

const importRows = (rows: Record<string, string>[], dryRun: boolean) =>
  ctx.call<ImportResultDto & { error?: { code: string; details: ImportResultDto } }>(
    secretary,
    "POST",
    "/students/import",
    { rows, dryRun },
  );

describe("importación desde Excel", () => {
  it("la vista previa valida sin crear nada", async () => {
    const res = await importRows([row(), row({ nombres: "Luis" })], true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, total: 2, valid: 2, created: 0 });
    expect((await ctx.call<{ total: number }>(secretary, "GET", "/students")).body.total).toBe(0);
  });

  it("explica cada error con su número de fila", async () => {
    const res = await importRows(
      [
        row(),
        row({ grado: "Quinto grado" }),
        row({ telefono: "" }),
        row({ fecha_nacimiento: "2015-13-45" }),
        row({ identidad: "0801201500001" }),
        row({ identidad: "0801-2015-00001", nombres: "Repetido" }),
      ],
      true,
    );
    const errors = Object.fromEntries(res.body.rows.map((r) => [r.row, r.errors.join(" | ")]));
    expect(errors[2]).toBe("");
    expect(errors[3]).toContain('No existe la sección "Quinto grado a"');
    expect(errors[4]).toContain("teléfono o un correo");
    expect(errors[5]).toContain("Fecha de nacimiento no válida");
    expect(errors[7]).toContain("se repite en la fila 6");
    expect(res.body.valid).toBe(2); // filas 2 y 6
  });

  it("detecta que el archivo llenaría una sección por encima del cupo", async () => {
    const res = await importRows(
      Array.from({ length: 4 }, (_, i) => row({ nombres: `Alumno ${i}` })),
      true,
    );
    expect(res.body.rows[3]?.errors[0]).toContain("cupo de 3");
  });

  it("si hay errores, al confirmar no se crea nada (todo o nada)", async () => {
    const res = await importRows([row(), row({ grado: "Inexistente" })], false);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("import_has_errors");
    expect((await ctx.call<{ total: number }>(secretary, "GET", "/students")).body.total).toBe(0);
  });

  it("importa alumnos, los matricula y agrupa hermanos con el mismo responsable", async () => {
    const res = await importRows(
      [
        row({
          nombres: "Ana",
          identidad_responsable: "0801198500011",
          fecha_nacimiento: "21/03/2019",
          sexo: "F",
        }),
        row({ nombres: "Pablo", identidad_responsable: "0801198500011", sexo: "masculino" }),
        row({
          nombres: "Sara",
          apellidos: "Mejía",
          seccion: "B",
          responsable: "Rosa Mejía",
          parentesco: "abuela",
        }),
        row({
          nombres: "Tomás",
          apellidos: "Mejía",
          seccion: "B",
          responsable: "Rosa Mejía",
          parentesco: "abuela",
        }),
      ],
      false,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 4, guardiansReused: 2 });

    const list = (await ctx.call<{ items: StudentListItemDto[] }>(secretary, "GET", "/students")).body.items;
    expect(list).toHaveLength(4);
    expect(list.every((s) => s.enrollment?.status === "activa")).toBe(true);

    const ana = list.find((s) => s.firstNames === "Ana");
    const detail = (await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${ana?.id}`)).body;
    expect(detail).toMatchObject({ birthDate: "2019-03-21", sex: "F" });
    expect(detail.guardians[0]).toMatchObject({ relationship: "madre", isPrimary: true });
    expect(detail.siblings.map((s) => s.fullName)).toEqual(["Pablo López"]);

    const sara = list.find((s) => s.firstNames === "Sara");
    const saraDetail = (await ctx.call<StudentDetailDto>(secretary, "GET", `/students/${sara?.id}`)).body;
    expect(saraDetail.siblings.map((s) => s.fullName)).toEqual(["Tomás Mejía"]);
    expect(saraDetail.guardians[0]?.relationship).toBe("abuelo");
  });

  it("no acepta archivos de más de 2,000 filas", async () => {
    const res = await importRows(
      Array.from({ length: 2001 }, () => row()),
      true,
    );
    expect(res.status).toBe(400);
  });
});
