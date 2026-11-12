import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  hotp,
  newRecoveryCodes,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from "./totp";

// Vectores de prueba del RFC 6238 (SHA-1, clave ASCII "12345678901234567890"), a 6 dígitos.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const vectors: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("TOTP", () => {
  it("da los códigos del RFC 6238", () => {
    for (const [seconds, code] of vectors) expect(totpCode(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
  });

  it("base32 va y vuelve", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
    expect(hotp(base32Decode(RFC_SECRET), 0)).toBe("755224"); // RFC 4226, contador 0
  });

  it("acepta el código anterior y el siguiente, pero no más lejos ni dos veces el mismo", () => {
    const now = new Date(1_800_000_000_000);
    const at = (seconds: number) => totpCode(RFC_SECRET, new Date(now.getTime() + seconds * 1000));
    const step = verifyTotp(RFC_SECRET, at(0), now);
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(-30), now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(30), now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(-90), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(0), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
  });

  it("arma el enlace para la app y códigos de recuperación legibles", () => {
    expect(otpauthUrl("ABC", "ana@ihb.hn")).toBe(
      "otpauth://totp/Plataforma%20Escolar%3Aana%40ihb.hn?secret=ABC&issuer=Plataforma%20Escolar&digits=6&period=30",
    );
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(hashRecoveryCode("k7qm 4xpt")).toBe(hashRecoveryCode("K7QM-4XPT"));
  });
});
