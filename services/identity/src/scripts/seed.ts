/**
 * Datos iniciales. Es idempotente: se puede correr varias veces sin duplicar nada.
 *
 * - Siempre: el superadmin de la plataforma (SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD).
 * - Con SEED_DEMO=true: "Colegio Demo" con un usuario de cada rol (contraseña SEED_DEMO_PASSWORD) y una
 *   conversación de ejemplo entre la dirección y un maestro.
 * - Con SEED_CENTRO_DEMO=true: "Centro Educativo Demostración CONECTA", el centro para enseñar CONECTA
 *   (y para la revisión de Google Play), con su personal (contraseña SEED_DEMO_PASSWORD). Los alumnos,
 *   las familias, las notas y el aula virtual los carga después academic con `seed-centro-demo`.
 */
import { databaseUrlFromEnv, optionalEnv, requireEnv } from "@escolar/service-kit";
import { CENTRO_DEMO, type SchoolRole } from "@escolar/shared";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { conversationMembers, conversations, messages, schools, users } from "../db/schema";
import { pairKeyOf } from "../lib/messages";
import { type AccountInput, grantAccess } from "../lib/users";

const { db, pool } = createDb(databaseUrlFromEnv());

/** Conversación de ejemplo: el maestro pide que le cubran una clase y la dirección responde. */
async function ensureDemoConversation(
  schoolId: string,
  directorId: string,
  teacherId: string,
  names = { teacher: "Diego", substitute: "la profesora Daniela" },
) {
  const pairKey = pairKeyOf(directorId, teacherId);
  const [existing] = await db.select().from(conversations).where(eq(conversations.pairKey, pairKey));
  if (existing) {
    console.log("  = conversación de ejemplo ya existe");
    return;
  }
  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
  const script: Array<[string, string, Date]> = [
    [
      teacherId,
      "Buenos días, directora. Hoy tengo cita en el centro de salud a las 10. ¿Alguien puede cubrir mi clase de Matemáticas en cuarto grado?",
      hoursAgo(26),
    ],
    [
      directorId,
      `Buenos días, ${names.teacher}. Sí, ${names.substitute} cubre esa hora. Deje la guía de trabajo en la dirección, por favor.`,
      hoursAgo(25.8),
    ],
    [teacherId, "Listo, ya la dejé. Gracias.", hoursAgo(25.7)],
    [
      directorId,
      `${names.teacher}, recuerde que el viernes se entregan las planificaciones de la próxima semana.`,
      hoursAgo(2),
    ],
  ];
  const last = script.at(-1);
  if (!last) return;
  await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({ schoolId, pairKey, lastMessageAt: last[2], lastSenderId: last[0] })
      .returning();
    if (!conversation) throw new Error("No se creó la conversación de ejemplo");
    // El maestro todavía no leyó el último mensaje de la dirección.
    await tx.insert(conversationMembers).values([
      { conversationId: conversation.id, userId: directorId, schoolId, lastReadAt: last[2] },
      { conversationId: conversation.id, userId: teacherId, schoolId, lastReadAt: script[2]?.[2] ?? null },
    ]);
    await tx.insert(messages).values(
      script.map(([senderUserId, body, createdAt]) => ({
        conversationId: conversation.id,
        schoolId,
        senderUserId,
        body,
        createdAt,
      })),
    );
  });
  console.log(`  + conversación de ejemplo entre la dirección y ${names.teacher}`);
}

async function ensureUser(input: AccountInput & { email: string }) {
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
      ["secretaria", "Sofía Secretaria", "secretaria@colegio-demo.hn"],
      ["docente", "Diego Docente", "docente@colegio-demo.hn"],
      ["docente", "Daniela Docente", "docente2@colegio-demo.hn"],
      ["padre", "Patricia Madre de Familia", "padre@colegio-demo.hn"],
    ];
    const created = new Map<string, string>();
    for (const [role, name, email] of demoUsers) {
      const user = await ensureUser({ schoolId: school.id, name, email, password, role });
      created.set(email, user.id);
    }
    const director = created.get("admin@colegio-demo.hn");
    const teacher = created.get("docente@colegio-demo.hn");
    if (director && teacher) await ensureDemoConversation(school.id, director, teacher);
  }

  if (optionalEnv("SEED_CENTRO_DEMO", "false") === "true") {
    const password = requireEnv("SEED_DEMO_PASSWORD");
    let [school] = await db.select().from(schools).where(eq(schools.slug, CENTRO_DEMO.slug));
    if (!school) {
      [school] = await db
        .insert(schools)
        .values({ slug: CENTRO_DEMO.slug, name: CENTRO_DEMO.name, sector: "privado" })
        .returning();
    }
    if (!school) throw new Error("No se pudo crear el centro de demostración");

    console.log(`${CENTRO_DEMO.name}:`);
    const created = new Map<string, string>();
    for (const [role, name, email] of CENTRO_DEMO.staff) {
      const user = await ensureUser({ schoolId: school.id, name, email, password, role });
      created.set(email, user.id);
    }
    const director = created.get(CENTRO_DEMO.staff[0][2]);
    const teacher = created.get(CENTRO_DEMO.staff[4][2]);
    if (director && teacher) {
      await ensureDemoConversation(school.id, director, teacher, {
        teacher: "Andrés",
        substitute: "la profesora Lucía",
      });
    }
  }
} finally {
  await pool.end();
}
