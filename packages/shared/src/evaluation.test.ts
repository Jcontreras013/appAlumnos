import { describe, expect, it } from "vitest";
import {
  activityInputSchema,
  attendanceRate,
  currentPeriod,
  defaultPeriods,
  finalResult,
  periodGrade,
  periodsInputSchema,
  roundGrade,
} from "./evaluation";

describe("parciales", () => {
  const periods = defaultPeriods("2026-02-02", "2026-11-27");

  it("divide el año en cuatro parciales seguidos que cubren todo el año", () => {
    expect(periods).toHaveLength(4);
    expect(periods[0]).toMatchObject({ name: "I Parcial", startsOn: "2026-02-02" });
    expect(periods[3]).toMatchObject({ name: "IV Parcial", endsOn: "2026-11-27", closesOn: "2026-12-04" });
    expect(periodsInputSchema.safeParse({ periods }).success).toBe(true);
  });

  it("rechaza parciales que se cruzan", () => {
    const [a, b] = periods;
    const bad = [a, { ...b, startsOn: a?.endsOn }];
    expect(periodsInputSchema.safeParse({ periods: bad }).success).toBe(false);
  });

  it("el parcial vigente es el que contiene la fecha; en vacaciones, el último que terminó", () => {
    expect(currentPeriod(periods, "2026-11-09")?.name).toBe("IV Parcial");
    expect(currentPeriod(periods, "2026-02-02")?.name).toBe("I Parcial");
    expect(currentPeriod(periods, "2026-12-20")?.name).toBe("IV Parcial");
  });
});

describe("nota del parcial", () => {
  const activities = [
    { id: "tarea", maxPoints: 20 },
    { id: "trabajo", maxPoints: 30 },
    { id: "examen", maxPoints: 50 },
  ];

  it("suma los puntos acumulados cuando el parcial ya repartió 100 puntos", () => {
    expect(periodGrade(activities, { tarea: 18, trabajo: 25.5, examen: 26 })).toMatchObject({
      points: 69.5,
      possible: 100,
      grade: 70, // 69.5 redondea a 70
      missing: 0,
    });
  });

  it("a mitad del parcial proyecta la nota en base 100 y cuenta lo que falta", () => {
    const partial = periodGrade(activities.slice(0, 2), { tarea: 10 });
    expect(partial).toMatchObject({ points: 10, possible: 50, grade: null, projected: 20, missing: 1 });
  });

  it("nunca acumula más del valor de la actividad", () => {
    expect(periodGrade([{ id: "a", maxPoints: 10 }], { a: 15 }).points).toBe(10);
  });

  it("redondea como en las boletas", () => {
    expect(roundGrade(69.49)).toBe(69);
    expect(roundGrade(69.5)).toBe(70);
  });

  it("valida el valor de las actividades", () => {
    const base = {
      id: crypto.randomUUID(),
      assignmentId: crypto.randomUUID(),
      periodId: crypto.randomUUID(),
      name: "Prueba",
      date: "2026-11-09",
    };
    expect(activityInputSchema.safeParse({ ...base, maxPoints: 7.5 }).success).toBe(true);
    expect(activityInputSchema.safeParse({ ...base, maxPoints: 7.3 }).success).toBe(false);
    expect(activityInputSchema.safeParse({ ...base, maxPoints: 120 }).success).toBe(false);
  });
});

describe("asistencia", () => {
  it("llegar tarde cuenta como asistió y la ausencia justificada no penaliza", () => {
    expect(attendanceRate(["presente", "tarde", "ausente", "justificada"])).toBeCloseTo(2 / 3);
    expect(attendanceRate(["justificada"])).toBeNull();
    expect(attendanceRate([])).toBeNull();
  });
});

describe("resultado final de una materia", () => {
  it("promedia los parciales y aplica la nota mínima", () => {
    expect(finalResult([70, 80, 90, 81], null, 70)).toEqual({ average: 80, status: "aprobada" });
    expect(finalResult([60, 70, 69, 70], null, 70)).toEqual({ average: 67, status: "reprobada" });
  });
  it("la recuperación aprueba solo si alcanza la nota mínima", () => {
    expect(finalResult([60, 60, 60, 60], 70, 70)).toEqual({ average: 60, status: "aprobada_recuperacion" });
    expect(finalResult([60, 60, 60, 60], 65, 70)).toEqual({ average: 60, status: "reprobada" });
  });
  it("sin todos los parciales, todavía no hay resultado", () => {
    expect(finalResult([80, null, 90, 70], null, 70)).toEqual({ average: null, status: "incompleta" });
    expect(finalResult([], null, 70)).toEqual({ average: null, status: "incompleta" });
  });
});
