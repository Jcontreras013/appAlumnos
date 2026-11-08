import { describe, expect, it } from "vitest";
import {
  createStudentInputSchema,
  formatNationalId,
  formatPhone,
  guardianInputSchema,
  mapImportHeaders,
  nationalIdSchema,
  parseFlexibleDate,
  phoneSchema,
} from "./enrollment";

describe("formatos de Honduras", () => {
  it("normaliza la identidad y la formatea", () => {
    expect(nationalIdSchema.parse("0801-2015-12345")).toBe("0801201512345");
    expect(nationalIdSchema.safeParse("0801-2015-123").success).toBe(false);
    expect(formatNationalId("0801201512345")).toBe("0801-2015-12345");
  });

  it("acepta teléfonos con +504, espacios o guiones", () => {
    expect(phoneSchema.parse("+504 9988-7766")).toBe("99887766");
    expect(phoneSchema.parse("2234 5678")).toBe("22345678");
    expect(phoneSchema.safeParse("12345").success).toBe(false);
    expect(formatPhone("99887766")).toBe("9988-7766");
  });

  it("entiende fechas en formato día/mes/año sin confundirlas", () => {
    expect(parseFlexibleDate("21/03/2015")).toBe("2015-03-21");
    expect(parseFlexibleDate("2015-03-21")).toBe("2015-03-21");
    expect(parseFlexibleDate("5-1-2016")).toBe("2016-01-05");
    expect(parseFlexibleDate("31/02/2015")).toBeNull();
    expect(parseFlexibleDate("marzo 2015")).toBeNull();
  });
});

describe("alumno y responsables", () => {
  const guardian = { fullName: "María López", relationship: "madre", phone: "9988-7766" };

  it("un responsable necesita teléfono o correo", () => {
    expect(guardianInputSchema.safeParse({ fullName: "María López", relationship: "madre" }).success).toBe(
      false,
    );
    expect(guardianInputSchema.safeParse(guardian).success).toBe(true);
  });

  it("los campos opcionales vacíos del formulario se ignoran", () => {
    const parsed = createStudentInputSchema.parse({
      firstNames: "Ana",
      lastNames: "López",
      nationalId: "",
      birthDate: "",
      guardians: [guardian],
      sectionId: "",
    });
    expect(parsed.nationalId).toBeUndefined();
    expect(parsed.sectionId).toBeUndefined();
  });

  it("no permite dos responsables principales", () => {
    const result = createStudentInputSchema.safeParse({
      firstNames: "Ana",
      lastNames: "López",
      guardians: [
        { ...guardian, isPrimary: true },
        { ...guardian, fullName: "José López", relationship: "padre", isPrimary: true },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("encabezados de importación", () => {
  it("reconoce encabezados con tildes, mayúsculas y sinónimos", () => {
    const { mapping, missing } = mapImportHeaders([
      "NOMBRES",
      "Apellidos",
      "Grado",
      "Sección",
      "Encargado",
      "Celular",
    ]);
    expect(missing).toEqual([]);
    expect(mapping.seccion).toBe(3);
    expect(mapping.responsable).toBe(4);
    expect(mapping.telefono).toBe(5);
  });

  it("indica qué columnas obligatorias faltan", () => {
    expect(mapImportHeaders(["Nombres", "Apellidos"]).missing).toEqual(["Grado", "Sección", "Responsable"]);
  });
});
