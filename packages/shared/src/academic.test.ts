import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_TEMPLATE,
  fieldKeyFromLabel,
  missingRequiredFields,
  parsePlanContent,
  planTemplateInputSchema,
  reviewPlanInputSchema,
} from "./academic";
import { addDays, currentWeek, formatWeekRange, isMonday, mondayOf } from "./weeks";

describe("semanas", () => {
  it("identifica lunes y calcula el lunes de cualquier día", () => {
    expect(isMonday("2026-11-09")).toBe(true);
    expect(isMonday("2026-11-10")).toBe(false);
    expect(mondayOf("2026-11-13")).toBe("2026-11-09"); // viernes
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // domingo: cierre de la semana
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
  });

  it("cruza meses y años correctamente", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(formatWeekRange("2026-11-30")).toBe("30 de nov al 4 de dic de 2026");
    expect(formatWeekRange("2026-11-09")).toBe("9 al 13 de nov de 2026");
  });

  it("usa la hora de Honduras para decidir la semana actual", () => {
    // Lunes 9 de nov a las 03:00 UTC sigue siendo domingo 8 en Honduras (UTC-6)
    expect(currentWeek(new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-02");
    expect(currentWeek(new Date("2026-11-09T07:00:00Z"))).toBe("2026-11-09");
  });

  it("rechaza fechas imposibles", () => {
    expect(isMonday("2026-02-30")).toBe(false);
    expect(isMonday("9/11/2026")).toBe(false);
  });
});

describe("plantilla", () => {
  it("la plantilla por defecto es válida", () => {
    expect(planTemplateInputSchema.safeParse(DEFAULT_PLAN_TEMPLATE).success).toBe(true);
  });

  it("rechaza claves repetidas", () => {
    const field = DEFAULT_PLAN_TEMPLATE.fields[0];
    const result = planTemplateInputSchema.safeParse({ deadlineDaysBefore: 3, fields: [field, field] });
    expect(result.success).toBe(false);
  });

  it("genera claves a partir de etiquetas con tildes", () => {
    expect(fieldKeyFromLabel("Evaluación formativa")).toBe("evaluacion_formativa");
    expect(fieldKeyFromLabel("1er objetivo")).toBe("campo_1er_objetivo");
  });
});

describe("contenido de la planificación", () => {
  const fields = DEFAULT_PLAN_TEMPLATE.fields;

  it("descarta campos que no están en la plantilla y recorta espacios", () => {
    const { content } = parsePlanContent(fields, { tema: "  Fracciones ", inventado: "x" });
    expect(content.tema).toBe("Fracciones");
    expect(content).not.toHaveProperty("inventado");
  });

  it("detecta obligatorios vacíos; en 'por días' basta con un día", () => {
    const { content } = parsePlanContent(fields, {
      tema: "Fracciones",
      estandar: "Suma fracciones",
      contenidos: "Fracciones homogéneas",
      actividades: { lunes: "Introducción" },
    });
    expect(missingRequiredFields(fields, content).map((f) => f.key)).toEqual(["evaluacion"]);
  });

  it("al devolver una planificación el comentario es obligatorio", () => {
    expect(reviewPlanInputSchema.safeParse({ decision: "devolver" }).success).toBe(false);
    expect(
      reviewPlanInputSchema.safeParse({ decision: "devolver", comment: "Falta la evaluación" }).success,
    ).toBe(true);
    expect(reviewPlanInputSchema.safeParse({ decision: "aprobar" }).success).toBe(true);
  });
});
