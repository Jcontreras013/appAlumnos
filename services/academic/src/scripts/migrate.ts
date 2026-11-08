import { databaseUrlFromEnv } from "@escolar/service-kit";
import { runMigrations } from "../db/client";

await runMigrations(databaseUrlFromEnv());
console.log("Migraciones de academic aplicadas.");
