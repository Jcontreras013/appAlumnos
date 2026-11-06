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
