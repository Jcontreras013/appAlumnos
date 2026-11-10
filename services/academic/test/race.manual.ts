/**
 * Prueba manual (no corre en CI): cupo con matrículas realmente concurrentes contra un Postgres real.
 *   DATABASE_URL=postgres://.../escolar_academic_race pnpm exec tsx test/race.manual.ts
 */
import { randomUUID } from "node:crypto";
import { createAccessTokenVerifier, JWT_ALGORITHM } from "@escolar/service-kit";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../src/app";
import { createDb, runMigrations } from "../src/db/client";

const url = process.env.DATABASE_URL as string;
await runMigrations(url);
const { db, pool } = createDb(url);
const keys = await generateKeyPair(JWT_ALGORITHM);
const app = await buildApp({
  db,
  identity: {
    getUser: async () => null,
    getScopeSchools: async () => [],
    createFamilyAccount: async () => {
      throw new Error("no se usa en esta prueba");
    },
    resetFamilyPassword: async () => {
      throw new Error("no se usa en esta prueba");
    },
    revokeFamilyAccount: async () => {},
  },
  verifier: await createAccessTokenVerifier({ publicKey: keys.publicKey }),
  today: () => "2026-11-09",
  logger: false,
});
const schoolId = randomUUID();
const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ role: "admin", school_id: schoolId, name: "Admin" })
  .setProtectedHeader({ alg: JWT_ALGORITHM })
  .setSubject(randomUUID())
  .setIssuer("escolar-identity")
  .setAudience("escolar-api")
  .setIssuedAt(now)
  .setExpirationTime(now + 600)
  .sign(keys.privateKey);
const call = (method: "POST" | "GET", path: string, payload?: object) =>
  app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, payload });

const year = (
  await call("POST", "/school-years", { name: "2026", startsOn: "2026-02-02", endsOn: "2026-11-27" })
).json();
const grade = (await call("POST", "/grades", { name: "Primero" })).json();
const section = (
  await call("POST", "/sections", { schoolYearId: year.id, gradeId: grade.id, name: "A", capacity: 5 })
).json();

const results = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    call("POST", "/students", {
      firstNames: `Alumno ${i}`,
      lastNames: "Prueba",
      guardians: [{ fullName: "Responsable", relationship: "madre", phone: "99887766" }],
      sectionId: section.id,
    }),
  ),
);
const after = (await call("GET", "/sections")).json()[0];
console.log(
  `20 matrículas simultáneas, cupo 5 -> aceptadas: ${results.filter((r) => r.statusCode === 201).length}, inscritos en la sección: ${after.enrolledCount}`,
);
await app.close();
await pool.end();
