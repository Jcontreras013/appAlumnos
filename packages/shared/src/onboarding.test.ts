import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, mapHeaders } from "./enrollment";
import { SCHOOL_IMPORT_COLUMNS, STAFF_IMPORT_COLUMNS, staffRoleFrom } from "./onboarding";

describe("plantillas de carga", () => {
  it.each([
    ["alumnos", IMPORT_COLUMNS],
    ["personal", STAFF_IMPORT_COLUMNS],
    ["centros", SCHOOL_IMPORT_COLUMNS],
  ] as const)("un archivo hecho con la plantilla de %s reconoce todas sus columnas", (_name, columns) => {
    const { mapping, missing } = mapHeaders(
      columns,
      columns.map((c) => c.label),
    );
    expect(missing).toEqual([]);
    expect(Object.keys(mapping).sort()).toEqual(columns.map((c) => c.key).sort());
  });

  it("encabezados escritos a mano: sin tildes, en mayúsculas o con otro nombre conocido", () => {
    const { mapping } = mapHeaders(SCHOOL_IMPORT_COLUMNS, [
      "ESCUELA",
      "Codigo SACE",
      "municipio",
      "Directora",
      "DNI director",
    ]);
    expect(mapping).toMatchObject({ centro: 0, codigo: 1, distrito: 2, director: 3, identidad_director: 4 });
  });
});

describe("cargos del personal", () => {
  it("entiende cómo se escribe el cargo en las escuelas; vacío es docente", () => {
    expect(staffRoleFrom("Maestra")).toBe("docente");
    expect(staffRoleFrom("")).toBe("docente");
    expect(staffRoleFrom("Coordinación")).toBe("coordinador");
    expect(staffRoleFrom("Secretario")).toBe("secretaria");
    expect(staffRoleFrom("conserje")).toBeNull();
  });
});
