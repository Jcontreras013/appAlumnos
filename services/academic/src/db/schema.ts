import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Aislamiento entre colegios a nivel de base de datos: cada tabla tiene school_id y las llaves
 * foráneas son compuestas (school_id, id). Así es imposible, aunque la API tuviera un bug, que una
 * sección cuelgue de un grado de otro colegio o que un alumno quede matriculado en una sección ajena.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const schoolId = () => uuid("school_id").notNull();

export const sexEnum = pgEnum("sex", ["F", "M"]);
export const relationshipEnum = pgEnum("relationship", ["madre", "padre", "tutor", "abuelo", "otro"]);
export const enrollmentStatusEnum = pgEnum("enrollment_status", ["activa", "retirada"]);

// ───────────────────────────── Estructura académica ─────────────────────────────

export const schoolYears = pgTable(
  "school_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("school_years_tenant_key").on(t.schoolId, t.id),
    unique("school_years_name_unique").on(t.schoolId, t.name),
    // Un solo año lectivo vigente por colegio
    uniqueIndex("school_years_one_current").on(t.schoolId).where(sql`${t.isCurrent}`),
  ],
);

export const grades = pgTable(
  "grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("grades_tenant_key").on(t.schoolId, t.id),
    unique("grades_name_unique").on(t.schoolId, t.name),
  ],
);

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    schoolYearId: uuid("school_year_id").notNull(),
    gradeId: uuid("grade_id").notNull(),
    name: text("name").notNull(),
    /** Cupo máximo de alumnos. null = sin límite. */
    capacity: integer("capacity"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sections_tenant_key").on(t.schoolId, t.id),
    unique("sections_year_key").on(t.schoolYearId, t.id),
    unique("sections_name_unique").on(t.schoolYearId, t.gradeId, t.name),
    foreignKey({
      name: "sections_school_year_fk",
      columns: [t.schoolId, t.schoolYearId],
      foreignColumns: [schoolYears.schoolId, schoolYears.id],
    }),
    foreignKey({
      name: "sections_grade_fk",
      columns: [t.schoolId, t.gradeId],
      foreignColumns: [grades.schoolId, grades.id],
    }),
  ],
);

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("subjects_tenant_key").on(t.schoolId, t.id),
    unique("subjects_name_unique").on(t.schoolId, t.name),
  ],
);

/** Qué docente da qué materia en qué sección. El nombre se guarda como copia para mostrarlo sin llamar a identity. */
export const teachingAssignments = pgTable(
  "teaching_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    sectionId: uuid("section_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    teacherUserId: uuid("teacher_user_id").notNull(),
    teacherName: text("teacher_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("assignments_tenant_key").on(t.schoolId, t.id),
    unique("assignments_section_subject_unique").on(t.sectionId, t.subjectId),
    index("assignments_teacher_idx").on(t.schoolId, t.teacherUserId),
    foreignKey({
      name: "assignments_section_fk",
      columns: [t.schoolId, t.sectionId],
      foreignColumns: [sections.schoolId, sections.id],
    }),
    foreignKey({
      name: "assignments_subject_fk",
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }),
  ],
);

// ───────────────────────────── Alumnos y familias ─────────────────────────────

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    firstNames: text("first_names").notNull(),
    lastNames: text("last_names").notNull(),
    /** Número de identidad (13 dígitos). Opcional: no todos los alumnos pequeños lo tienen a mano. */
    nationalId: text("national_id"),
    birthDate: date("birth_date", { mode: "string" }),
    sex: sexEnum("sex"),
    /** Alergias o condiciones de salud: se mostrarán también en la cafetería (fase 4). */
    medicalNotes: text("medical_notes"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("students_tenant_key").on(t.schoolId, t.id),
    uniqueIndex("students_national_id_unique")
      .on(t.schoolId, t.nationalId)
      .where(sql`${t.nationalId} is not null`),
    index("students_name_idx").on(t.schoolId, t.lastNames, t.firstNames),
  ],
);

/**
 * Responsables (madre, padre, tutor). Un mismo responsable puede estar ligado a varios hermanos:
 * es la base de la "familia" para estados de cuenta y descuentos por hermanos (fase 3).
 */
export const guardians = pgTable(
  "guardians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    fullName: text("full_name").notNull(),
    nationalId: text("national_id"),
    phone: text("phone"),
    email: text("email"),
    /** Cuenta del portal de padres (identity), cuando se le cree una. */
    userId: uuid("user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("guardians_tenant_key").on(t.schoolId, t.id),
    uniqueIndex("guardians_national_id_unique")
      .on(t.schoolId, t.nationalId)
      .where(sql`${t.nationalId} is not null`),
  ],
);

export const studentGuardians = pgTable(
  "student_guardians",
  {
    schoolId: schoolId(),
    studentId: uuid("student_id").notNull(),
    guardianId: uuid("guardian_id").notNull(),
    relationship: relationshipEnum("relationship").notNull(),
    /** Responsable principal: contacto para cobros y emergencias. Exactamente uno por alumno. */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "student_guardians_pk", columns: [t.studentId, t.guardianId] }),
    uniqueIndex("student_guardians_one_primary").on(t.studentId).where(sql`${t.isPrimary}`),
    index("student_guardians_guardian_idx").on(t.guardianId),
    foreignKey({
      name: "student_guardians_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "student_guardians_guardian_fk",
      columns: [t.schoolId, t.guardianId],
      foreignColumns: [guardians.schoolId, guardians.id],
    }),
  ],
);

/** Matrícula de un alumno en una sección para un año lectivo. Una por alumno y año. */
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    studentId: uuid("student_id").notNull(),
    schoolYearId: uuid("school_year_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    status: enrollmentStatusEnum("status").notNull().default("activa"),
    enrolledOn: date("enrolled_on", { mode: "string" }).notNull(),
    withdrawnOn: date("withdrawn_on", { mode: "string" }),
    withdrawReason: text("withdraw_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("enrollments_tenant_key").on(t.schoolId, t.id),
    unique("enrollments_student_year_unique").on(t.studentId, t.schoolYearId),
    index("enrollments_section_idx").on(t.sectionId, t.status),
    foreignKey({
      name: "enrollments_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }),
    // La sección debe ser del mismo colegio Y del mismo año lectivo de la matrícula.
    foreignKey({
      name: "enrollments_section_fk",
      columns: [t.schoolId, t.sectionId],
      foreignColumns: [sections.schoolId, sections.id],
    }),
    foreignKey({
      name: "enrollments_section_year_fk",
      columns: [t.schoolYearId, t.sectionId],
      foreignColumns: [sections.schoolYearId, sections.id],
    }),
  ],
);

/** Bitácora de cambios. Solo inserción. */
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
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_school_created_idx").on(t.schoolId, t.createdAt)],
);

export type SchoolYear = typeof schoolYears.$inferSelect;
export type Grade = typeof grades.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type TeachingAssignment = typeof teachingAssignments.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Guardian = typeof guardians.$inferSelect;
export type StudentGuardian = typeof studentGuardians.$inferSelect;
export type Enrollment = typeof enrollments.$inferSelect;
