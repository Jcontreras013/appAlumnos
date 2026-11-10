import { ROLES, SCHOOL_SECTORS } from "@escolar/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);
export const sectorEnum = pgEnum("school_sector", SCHOOL_SECTORS);

// ───────────────────────────── Jerarquía de la Secretaría de Educación ─────────────────────────────

/** Departamento (Dirección Departamental de Educación). Código oficial 01-18. */
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique("departments_code_unique"),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/** Distrito educativo dentro de un departamento. */
export const districts = pgTable(
  "districts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("districts_name_unique").on(t.departmentId, t.name)],
);

/** Cada centro educativo (escuela, CEB, colegio) es un tenant. Los privados pueden no tener distrito. */
export const schools = pgTable(
  "schools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique("schools_slug_unique"),
    name: text("name").notNull(),
    rtn: text("rtn"),
    /** Código del centro (el del SACE en escuelas públicas). */
    code: text("code"),
    sector: sectorEnum("sector").notNull().default("privado"),
    districtId: uuid("district_id").references(() => districts.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    /** Cuándo se cambió el logo por última vez (null = sin logo). Sirve para invalidar la caché del navegador. */
    logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("schools_district_idx").on(t.districtId),
    uniqueIndex("schools_code_unique").on(t.code).where(sql`${t.code} is not null`),
  ],
);

/** node-postgres devuelve Buffer y PGlite Uint8Array: se normaliza a Buffer. */
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.from(value),
});

/** Logo del colegio, en una tabla aparte para no leer la imagen en cada consulta de colegios. */
export const schoolLogos = pgTable("school_logos", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => schools.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────────────────────────── Personas y accesos ─────────────────────────────

/** Una persona. Sus roles y centros están en `memberships`. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Siempre en minúsculas (lo normaliza el esquema Zod). Único en toda la plataforma. */
    email: text("email").unique("users_email_unique"),
    /** Número de identidad (13 dígitos): las familias sin correo entran con él. */
    nationalId: text("national_id").unique("users_national_id_unique"),
    passwordHash: text("password_hash").notNull(),
    /** Contraseña temporal entregada por el centro: hay que cambiarla al entrar. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    /** Intentos fallidos seguidos; al llegar al límite la cuenta se bloquea unos minutos. */
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    /** Último acceso usado: al iniciar sesión se entra directo a ese centro. */
    lastMembershipId: uuid("last_membership_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("users_login_identifier", sql`${t.email} is not null or ${t.nationalId} is not null`)],
);

/**
 * Acceso de una persona: un rol en un centro, un distrito o un departamento.
 * Una maestra puede tener dos (escuela matutina y vespertina); un director distrital, uno a su distrito.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    schoolId: uuid("school_id").references(() => schools.id, { onDelete: "restrict" }),
    districtId: uuid("district_id").references(() => districts.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memberships_user_idx").on(t.userId),
    index("memberships_school_idx").on(t.schoolId),
    unique("memberships_unique")
      .on(t.userId, t.role, t.schoolId, t.districtId, t.departmentId)
      .nullsNotDistinct(),
    // Regla en la base de datos: cada rol con exactamente su ámbito. Ningún bug de la API puede dejar
    // a un docente sin centro ni a una dirección departamental atada a una escuela.
    // (Se compara role::text para poder agregar roles nuevos en la misma migración.)
    check(
      "memberships_scope_matches_role",
      sql`case ${t.role}::text
        when 'superadmin' then ${t.schoolId} is null and ${t.districtId} is null and ${t.departmentId} is null
        when 'director_departamental' then ${t.departmentId} is not null and ${t.schoolId} is null and ${t.districtId} is null
        when 'director_distrital' then ${t.districtId} is not null and ${t.schoolId} is null and ${t.departmentId} is null
        else ${t.schoolId} is not null and ${t.districtId} is null and ${t.departmentId} is null
      end`,
    ),
  ],
);

/**
 * Refresh tokens con rotación. Solo se guarda el hash SHA-256 del token, nunca el token.
 * Todos los tokens que salen de un mismo login comparten `familyId`: si un token ya rotado se
 * vuelve a usar (señal de robo), se revoca la familia completa. Cada sesión trabaja con un acceso.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique("refresh_tokens_hash_unique"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("refresh_tokens_family_idx").on(t.familyId),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_membership_idx").on(t.membershipId),
  ],
);

/** Bitácora de auditoría: solo se inserta, nunca se actualiza ni se borra. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id"),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    data: jsonb("data"),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_school_created_idx").on(t.schoolId, t.createdAt)],
);

export type Department = typeof departments.$inferSelect;
export type District = typeof districts.$inferSelect;
export type School = typeof schools.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
