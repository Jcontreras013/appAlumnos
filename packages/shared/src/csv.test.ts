import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("CSV", () => {
  it("lee CSV de Excel en español (punto y coma, BOM, CRLF)", () => {
    const text = "﻿Nombres;Apellidos;Grado\r\nAna;López;Primer grado\r\n\r\n";
    expect(parseCsv(text)).toEqual([
      ["Nombres", "Apellidos", "Grado"],
      ["Ana", "López", "Primer grado"],
    ]);
  });

  it("respeta comillas con separadores y comillas dentro", () => {
    const text = 'nombre,nota\n"Pérez, Juan","Dijo ""hola""\nen dos líneas"\n';
    expect(parseCsv(text)).toEqual([
      ["nombre", "nota"],
      ["Pérez, Juan", 'Dijo "hola"\nen dos líneas'],
    ]);
  });

  it("lo que escribe toCsv se vuelve a leer igual", () => {
    const rows = [
      ["Nombres", "Notas"],
      ["Ana; Sofía", 'Alergia a "maní"'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
