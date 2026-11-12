import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Códigos de un solo uso por tiempo (TOTP, RFC 6238): los de Google Authenticator, Microsoft
 * Authenticator y similares. 6 dígitos que cambian cada 30 segundos.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Se acepta el código anterior y el siguiente: tolera relojes de teléfono un poco desfasados. */
const WINDOW = 1;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Clave base32 inválida");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Clave nueva de 160 bits (lo que recomienda el RFC 4226), en base32 para la app del teléfono. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const stepAt = (now: Date) => Math.floor(now.getTime() / 1000 / STEP_SECONDS);

/** Código HOTP (RFC 4226) para un contador. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(message).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export const totpCode = (secretBase32: string, now: Date) => hotp(base32Decode(secretBase32), stepAt(now));

/**
 * Revisa un código. Devuelve el paso de tiempo que usó (para no aceptar el mismo código dos veces)
 * o null si no sirve. `lastStep` es el último paso aceptado.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  now: Date,
  lastStep: number | null = null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = stepAt(now);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

/** Enlace que leen las apps de autenticación (también se muestra como código QR). */
export function otpauthUrl(secretBase32: string, account: string, issuer = "Plataforma Escolar"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  // %20 y no "+": algunas apps de autenticación muestran el "+" tal cual.
  const query = [
    `secret=${secretBase32}`,
    `issuer=${encodeURIComponent(issuer)}`,
    `digits=${DIGITS}`,
    `period=${STEP_SECONDS}`,
  ].join("&");
  return `otpauth://totp/${label}?${query}`;
}

// ── Códigos de recuperación (por si se pierde el teléfono) ──

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I

/** Diez códigos de un solo uso como "K7QM-4XPT". Se guardan solo sus hash. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

/** Tienen 40 bits al azar y son de un solo uso: basta un hash rápido. */
export const hashRecoveryCode = (code: string) =>
  createHash("sha256")
    .update(code.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .digest("hex");
