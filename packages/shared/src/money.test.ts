import { describe, expect, it } from "vitest";
import {
  allocateEvenly,
  applyBasisPoints,
  formatLempiras,
  MoneyError,
  parseToCents,
  sumCents,
} from "./money";

describe("parseToCents", () => {
  it.each([
    ["1,250.50", 125050],
    ["1250.5", 125050],
    ["L 300", 30000],
    ["L. 0.05", 5],
    ["0", 0],
    ["-15.25", -1525],
  ])("%s => %i", (input, expected) => {
    expect(parseToCents(input)).toBe(expected);
  });

  it("no pierde precisión donde el punto flotante falla", () => {
    // 0.1 + 0.2 !== 0.3 en float; en centavos sí cuadra
    expect(parseToCents("0.10") + parseToCents("0.20")).toBe(parseToCents("0.30"));
  });

  it.each(["", "abc", "1.234", "1.2.3", "12,34a"])("rechaza %j", (input) => {
    expect(() => parseToCents(input)).toThrow(MoneyError);
  });

  it("rechaza montos fuera del rango seguro", () => {
    expect(() => parseToCents("999999999999999999")).toThrow(MoneyError);
  });
});

describe("formatLempiras", () => {
  it.each([
    [125050, "L 1,250.50"],
    [5, "L 0.05"],
    [0, "L 0.00"],
    [100000000, "L 1,000,000.00"],
    [-1525, "-L 15.25"],
  ])("%i => %s", (cents, expected) => {
    expect(formatLempiras(cents)).toBe(expected);
  });

  it("rechaza montos con decimales", () => {
    expect(() => formatLempiras(10.5)).toThrow(MoneyError);
  });
});

describe("applyBasisPoints", () => {
  it("calcula ISV 15%", () => {
    expect(applyBasisPoints(10000, 1500)).toBe(1500);
  });

  it("redondea medio centavo hacia arriba", () => {
    // 15% de L 0.03 = 0.45 centavos => 0; 15% de L 0.10 = 1.5 centavos => 2
    expect(applyBasisPoints(3, 1500)).toBe(0);
    expect(applyBasisPoints(10, 1500)).toBe(2);
    expect(applyBasisPoints(-10, 1500)).toBe(-2);
  });

  it("no se desborda con montos grandes", () => {
    const big = 9_000_000_000_000; // L 90 mil millones
    expect(applyBasisPoints(big, 1800)).toBe(1_620_000_000_000);
  });
});

describe("allocateEvenly", () => {
  it("reparte sin perder centavos", () => {
    expect(allocateEvenly(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(sumCents(allocateEvenly(100000, 3))).toBe(100000);
  });

  it("reparte 10 cuotas de colegiatura", () => {
    const parts = allocateEvenly(1234567, 10);
    expect(parts).toHaveLength(10);
    expect(sumCents(parts)).toBe(1234567);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it("rechaza partes inválidas", () => {
    expect(() => allocateEvenly(100, 0)).toThrow(MoneyError);
  });
});
