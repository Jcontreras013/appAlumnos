import { describe, expect, it } from "vitest";
import { weakPasswordReason } from "./passwords";
import { passwordSchema } from "./schemas";

describe("contraseñas fáciles de adivinar", () => {
  it.each([
    "1234567890",
    "0801199012345",
    "9988-7766-55",
    "aaaaaaaaaaaa",
    "1212121212",
    "abcdefghijk",
    "qwertyuiop",
    "1q2w3e4r5t",
    "Honduras2026",
    "honduras.2026!",
    "2026Honduras",
    "Contraseña123",
    "P@ssw0rd2026",
    "p4ssw0rd!!!",
    "Admin-12345",
    "Escuela2026",
    "Bienvenido1",
    "Olimpia1912",
  ])("rechaza %s", (pw) => {
    expect(weakPasswordReason(pw)).not.toBeNull();
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });

  it.each([
    "Demo-colegio-2026",
    "contraseña-de-prueba-1",
    "Ceiba-4821-Coral",
    "mango-río-4821-tarde",
    "superadmin-segura-123",
    "nueva-clave-segura",
    "mi perro come mangos",
    "Honduras-y-sus-pinos-26",
  ])("acepta %s", (pw) => {
    expect(weakPasswordReason(pw)).toBeNull();
    expect(passwordSchema.safeParse(pw).success).toBe(true);
  });

  it("el mensaje explica qué hacer", () => {
    const r = passwordSchema.safeParse("Honduras2026");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/más usadas/);
  });
});
