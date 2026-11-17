import { describe, expect, it } from "vitest";
import { disciplineInputSchema, disciplineKindsFor, isSuspendedOn } from "./discipline";

const base = {
  kind: "llamado_escrito",
  severity: "leve",
  date: "2026-11-10",
  description: "Usó el celular en clase.",
};

describe("disciplina", () => {
  it("un llamado de atención no guarda fechas de suspensión", () => {
    const r = disciplineInputSchema.parse({
      ...base,
      suspensionFrom: "2026-11-11",
      suspensionTo: "2026-11-12",
      notifyFamily: "on",
    });
    expect(r.suspensionFrom).toBeUndefined();
    expect(r.notifyFamily).toBe(true);
    expect(disciplineInputSchema.parse(base).notifyFamily).toBe(false);
  });

  it("una suspensión pide desde y hasta, en orden y desde la falta", () => {
    const sin = disciplineInputSchema.safeParse({ ...base, kind: "suspension" });
    expect(sin.success).toBe(false);
    const alReves = disciplineInputSchema.safeParse({
      ...base,
      kind: "suspension",
      suspensionFrom: "2026-11-12",
      suspensionTo: "2026-11-11",
    });
    expect(alReves.error?.issues[0]?.message).toBe("Termina antes de empezar");
    const antes = disciplineInputSchema.safeParse({
      ...base,
      kind: "suspension",
      suspensionFrom: "2026-11-09",
      suspensionTo: "2026-11-11",
    });
    expect(antes.error?.issues[0]?.message).toBe("No puede empezar antes de la falta");
    const ok = disciplineInputSchema.parse({
      ...base,
      kind: "suspension",
      suspensionFrom: "2026-11-11",
      suspensionTo: "2026-11-13",
    });
    expect(ok).toMatchObject({ suspensionFrom: "2026-11-11", suspensionTo: "2026-11-13" });
  });

  it("pide qué pasó", () => {
    expect(disciplineInputSchema.safeParse({ ...base, description: " " }).success).toBe(false);
  });

  it("la suspensión y la expulsión solo las aplica la dirección", () => {
    expect(disciplineKindsFor("admin")).toContain("expulsion");
    expect(disciplineKindsFor("coordinador")).not.toContain("suspension");
    expect(disciplineKindsFor("docente")).toEqual(["llamado_verbal", "llamado_escrito", "citacion"]);
    expect(disciplineKindsFor("padre")).toEqual([]);
  });

  it("sabe si el alumno está suspendido en un día", () => {
    const s = { kind: "suspension" as const, suspensionFrom: "2026-11-11", suspensionTo: "2026-11-13" };
    expect(isSuspendedOn(s, "2026-11-12")).toBe(true);
    expect(isSuspendedOn(s, "2026-11-14")).toBe(false);
  });
});
