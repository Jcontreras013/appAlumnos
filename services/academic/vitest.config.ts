import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada archivo levanta su propio Postgres en memoria (PGlite) y corre las migraciones reales.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
