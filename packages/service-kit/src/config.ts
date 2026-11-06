/** Lectura de variables de entorno que falla al arrancar (no a mitad de una petición) si falta algo. */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`La variable de entorno ${name} debe ser un entero (recibido: ${raw})`);
  }
  return value;
}

/** Las llaves PEM se guardan en una sola línea con "\n" literales (formato .env / Secrets Manager). */
export function pemEnv(name: string): string {
  return requireEnv(name).replace(/\\n/g, "\n");
}

/**
 * URL de Postgres. En local viene completa en DATABASE_URL; en AWS, ECS inyecta las partes por
 * separado desde el secreto de RDS (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME) y se arma aquí.
 */
export function databaseUrlFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  const user = encodeURIComponent(requireEnv("DB_USER"));
  const password = encodeURIComponent(requireEnv("DB_PASSWORD"));
  const host = requireEnv("DB_HOST");
  const port = optionalEnv("DB_PORT", "5432");
  const name = requireEnv("DB_NAME");
  const sslmode = optionalEnv("DB_SSLMODE", "require");
  return `postgres://${user}:${password}@${host}:${port}/${name}?sslmode=${sslmode}`;
}
