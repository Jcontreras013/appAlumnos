/**
 * Dinero en centavos enteros.
 *
 * Regla de la plataforma: ningún monto se guarda ni se calcula con decimales de punto flotante.
 * Todo monto es un entero de centavos (L 1,250.50 => 125050). Los cálculos que pueden pasar del
 * rango seguro de `number` (porcentajes sobre montos grandes) se hacen con BigInt.
 */

export type Cents = number;

const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {
  override name = "MoneyError";
}

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Monto inválido: ${value}. Los montos deben ser centavos enteros.`);
  }
}

/**
 * Convierte texto escrito por una persona ("1,250.50", "1250.5", "L 300") a centavos.
 * Rechaza más de dos decimales en vez de redondear en silencio.
 */
export function parseToCents(input: string): Cents {
  const cleaned = input
    .trim()
    .replace(/^L\.?\s*/i, "")
    .replace(/,/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyError(`"${input}" no es un monto válido (máximo dos decimales).`);
  }
  const [, sign, whole = "0", fraction = ""] = match;
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(MAX_CENTS)) {
    throw new MoneyError(`"${input}" excede el monto máximo permitido.`);
  }
  const value = Number(cents);
  return sign ? -value : value;
}

/** Formatea centavos como Lempiras: 125050 => "L 1,250.50". No depende del ICU del sistema. */
export function formatLempiras(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}L ${whole}.${fraction}`;
}

/**
 * Aplica un porcentaje expresado en puntos básicos (15% = 1500) con redondeo
 * "half away from zero", el usual en facturación (0.5 centavos sube).
 */
export function applyBasisPoints(cents: Cents, basisPoints: number): Cents {
  assertCents(cents);
  if (!Number.isInteger(basisPoints)) {
    throw new MoneyError("Los puntos básicos deben ser enteros (15% = 1500).");
  }
  const product = BigInt(cents) * BigInt(basisPoints);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 5000n) / 10000n;
  const result = Number(negative ? -rounded : rounded);
  assertCents(result);
  return result;
}

/**
 * Reparte un monto en `parts` partes que suman exactamente el total.
 * Los centavos sobrantes se asignan a las primeras partes: 1000.00 / 3 => 333.34, 333.33, 333.33.
 * Útil para cuotas de matrícula o colegiatura.
 */
export function allocateEvenly(cents: Cents, parts: number): Cents[] {
  assertCents(cents);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError("El número de partes debe ser un entero positivo.");
  }
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  const base = Math.floor(abs / parts);
  const remainder = abs % parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  assertCents(total);
  return total;
}
