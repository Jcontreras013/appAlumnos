import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  it("no distingue tildes ni mayúsculas", () => {
    expect(matchesSearch("Martínez Brooks, Ana", "martinez")).toBe(true);
    expect(matchesSearch("Martinez Brooks, Ana", "MARTÍNEZ")).toBe(true);
  });

  it("acepta las palabras en cualquier orden y exige todas", () => {
    expect(matchesSearch("Martínez Brooks, Ana", "ana martinez")).toBe(true);
    expect(matchesSearch("Martínez Brooks, Ana", "ana cruz")).toBe(false);
  });

  it("encuentra la identidad con o sin guiones", () => {
    expect(matchesSearch("Ana Cruz 0801-1985-01234", "08011985")).toBe(true);
    expect(matchesSearch("Ana Cruz 0801198501234", "0801-1985")).toBe(true);
  });

  it("una búsqueda vacía o de solo signos no filtra nada", () => {
    expect(matchesSearch("Ana", "")).toBe(true);
    expect(matchesSearch("Ana", "   ")).toBe(true);
    expect(matchesSearch("Ana", "-")).toBe(true);
  });
});
