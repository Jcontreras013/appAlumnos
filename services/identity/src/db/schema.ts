import { ROLES } from "@escolar/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);

/** Cada colegio es un tenant. Todos los datos de negocio de la plataforma cuelgan de un school_id. */
export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique("schools_slug_unique"),
  name: text("name").notNull(),
  rtn: text("rtn"),
  active: boolean("active").notNull().default(true),
  /** Cuándo se cambió el logo por última vez (null = sin logo). Sirve para invalidar la caché del navegador. */
  logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
  createdAt: createdAt(),
});

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

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").references(() => schools.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Siempre en minúsculas (lo normaliza el esquema Zod). Único en toda la plataforma. */
    email: text("email").notNull().unique("users_email_unique"),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("users_school_idx").on(t.schoolId),
    // Regla a nivel de base de datos: superadmin <=> sin colegio. Ningún bug de la API puede
    // dejar a un usuario de colegio sin tenant ni a un superadmin atado a un colegio.
    check("users_superadmin_has_no_school", sql`(${t.role} = 'superadmin') = (${t.schoolId} is null)`),
  ],
);

/**
 * Refresh tokens con rotación. Solo se guarda el hash SHA-256 del token, nunca el token.
 * Todos los tokens que salen de un mismo login comparten `familyId`: si un token ya rotado se
 * vuelve a usar (señal de robo), se revoca la familia completa.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique("refresh_tokens_hash_unique"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    createdAt: createdAt(),
  },
  (t) => [index("refresh_tokens_family_idx").on(t.familyId), index("refresh_tokens_user_idx").on(t.userId)],
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

export type School = typeof schools.$inferSelect;
export type User = typeof users.$inferSelect;
