import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/scripts/migrate.ts", "src/scripts/seed.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Los paquetes internos del monorepo se publican como TypeScript: se incluyen en el bundle.
  noExternal: [/^@escolar\//],
});
