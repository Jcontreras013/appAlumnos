import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/** Argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 iteraciones). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifica una contraseña. Si el usuario no existe (`storedHash` null) igual se calcula un hash,
 * para que la respuesta tarde lo mismo y no se pueda averiguar qué correos están registrados.
 */
export async function verifyPassword(storedHash: string | null, password: string): Promise<boolean> {
  if (storedHash === null) {
    dummyHash ??= hashPassword("contraseña-ficticia-para-igualar-tiempos");
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

// Palabras sin tildes ni eñes: la contraseña temporal se dicta por teléfono o se escribe en un papel.
const WORDS = [
  "Ceiba",
  "Coral",
  "Mango",
  "Palma",
  "Garza",
  "Tucan",
  "Lapa",
  "Roble",
  "Brisa",
  "Delfin",
  "Iguana",
  "Jaguar",
  "Caracol",
  "Marea",
  "Pino",
  "Guara",
  "Arena",
  "Velero",
  "Faro",
  "Ola",
];

/** "Ceiba-4821-Coral": fácil de dictar y de escribir, y de un solo uso (se cambia al entrar). */
export function temporaryPassword(): string {
  const word = () => WORDS[randomInt(WORDS.length)] as string;
  return `${word()}-${randomInt(1000, 10000)}-${word()}`;
}
