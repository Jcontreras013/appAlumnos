/**
 * Datos iniciales. Es idempotente: se puede correr varias veces sin duplicar nada.
 *
 * - Siempre: el superadmin de la plataforma (SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD).
 * - Con SEED_DEMO=true: "Colegio Demo" con un usuario de cada rol (contraseña SEED_DEMO_PASSWORD).
 */
import { databaseUrlFromEnv, optionalEnv, requireEnv } from "@escolar/service-kit";
import type { SchoolRole } from "@escolar/shared";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { schools, users } from "../db/schema";
import { type AccountInput, grantAccess } from "../lib/users";

const { db, pool } = createDb(databaseUrlFromEnv());

async function ensureUser(input: AccountInput) {
  const [existing] = await db.select().from(users).where(eq(users.email, input.email));
  if (existing) {
    console.log(`  = ${input.email} ya existe`);
    return existing;
  }
  const { user } = await grantAccess(db, input);
  console.log(`  + ${input.email} (${input.role})`);
  return user;
}

try {
  console.log("Superadmin:");
  await ensureUser({
    schoolId: null,
    name: "Equipo de la plataforma",
    email: optionalEnv("SEED_SUPERADMIN_EMAIL", "superadmin@escolar.local"),
    password: requireEnv("SEED_SUPERADMIN_PASSWORD"),
    role: "superadmin",
  });

  if (optionalEnv("SEED_DEMO", "false") === "true") {
    const password = requireEnv("SEED_DEMO_PASSWORD");
    let [school] = await db.select().from(schools).where(eq(schools.slug, "colegio-demo"));
    if (!school) {
      [school] = await db
        .insert(schools)
        .values({ slug: "colegio-demo", name: "Colegio Demo", rtn: "08019000000000" })
        .returning();
    }
    if (!school) throw new Error("No se pudo crear el colegio demo");

    console.log("Colegio Demo:");
    const demoUsers: Array<[SchoolRole, string, string]> = [
      ["admin", "Ana Administradora", "admin@colegio-demo.hn"],
      ["coordinador", "Carmen Coordinadora", "coordinacion@colegio-demo.hn"],
      ["finanzas", "Fernando Finanzas", "finanzas@colegio-demo.hn"],
      ["secretaria", "Sofía Secretaria", "secretaria@colegio-demo.hn"],
      ["docente", "Diego Docente", "docente@colegio-demo.hn"],
      ["docente", "Daniela Docente", "docente2@colegio-demo.hn"],
      ["padre", "Patricia Madre de Familia", "padre@colegio-demo.hn"],
    ];
    for (const [role, name, email] of demoUsers) {
      await ensureUser({ schoolId: school.id, name, email, password, role });
    }
  }
} finally {
  await pool.end();
}
