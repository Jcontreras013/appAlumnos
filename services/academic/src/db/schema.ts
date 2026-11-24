import {
  ANNOUNCEMENT_AUDIENCES,
  ATTENDANCE_STATUSES,
  type ClassMaterialKind,
  type ClassPostKind,
  CONDUCT_CATEGORIES,
  CONDUCT_MEASURES,
  CONDUCT_SEVERITIES,
  DAY_OFF_KINDS,
  DEFAULT_PASSING_GRADE,
  type DocContent,
  type DocumentTemplate,
  type DocumentVisibility,
  FOLLOW_UP_KINDS,
  LEAVE_TYPES,
  type LibraryAudience,
  type LibraryKind,
  PLAN_STATUSES,
  type PlanContent,
  type PlanField,
  type SubjectLanguage,
  type TransferSnapshot,
} from "@escolar/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
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
export const leaveTypeEnum = pgEnum("leave_type", LEAVE_TYPES);
export const attendanceStatusEnum = pgEnum("attendance_status", ATTENDANCE_STATUSES);
export const planStatusEnum = pgEnum("plan_status", PLAN_STATUSES);
export const followUpKindEnum = pgEnum("follow_up_kind", FOLLOW_UP_KINDS);
export const conductSeverityEnum = pgEnum("conduct_severity", CONDUCT_SEVERITIES);
export const conductCategoryEnum = pgEnum("conduct_category", CONDUCT_CATEGORIES);
export const conductMeasureEnum = pgEnum("conduct_measure", CONDUCT_MEASURES);
export const announcementAudienceEnum = pgEnum("announcement_audience", ANNOUNCEMENT_AUDIENCES);
export const dayOffKindEnum = pgEnum("day_off_kind", DAY_OFF_KINDS);
export const transferStatusEnum = pgEnum("transfer_status", ["pendiente", "recibido", "cancelado"]);
export const planActionEnum = pgEnum("plan_action", [
  "creada",
  "guardada",
  "enviada",
  "aprobada",
  "devuelta",
]);

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
    /** Idioma en que se imparte (colegios bilingües): el asistente planifica en ese idioma. */
    language: text("language").$type<SubjectLanguage>().notNull().default("es"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("subjects_tenant_key").on(t.schoolId, t.id),
    unique("subjects_name_unique").on(t.schoolId, t.name),
    check("subjects_language", sql`${t.language} in ('es', 'en')`),
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
    /** Correo del alumno: con él entra al aula virtual si no tiene identidad a mano. */
    email: text("email"),
    /** Cuenta del alumno en el aula virtual (identity), cuando se le cree una. */
    userId: uuid("user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("students_tenant_key").on(t.schoolId, t.id),
    uniqueIndex("students_national_id_unique")
      .on(t.schoolId, t.nationalId)
      .where(sql`${t.nationalId} is not null`),
    uniqueIndex("students_user_unique").on(t.schoolId, t.userId).where(sql`${t.userId} is not null`),
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

// ───────────────────────────── Licencias y sustituciones ─────────────────────────────

/**
 * Biblioteca virtual: libros, guías y lecturas (archivo guardado en S3 o la carpeta de la demo) o
 * enlaces, por grado y materia (ambos opcionales: sin grado, es para todo el centro).
 */
export const libraryItems = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    kind: text("kind").$type<LibraryKind>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key").unique(),
    gradeId: uuid("grade_id"),
    subjectId: uuid("subject_id"),
    audience: text("audience").$type<LibraryAudience>().notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "library_items_grade_fk",
      columns: [t.schoolId, t.gradeId],
      foreignColumns: [grades.schoolId, grades.id],
    }),
    foreignKey({
      name: "library_items_subject_fk",
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }),
    index("library_items_school_idx").on(t.schoolId, t.createdAt),
    check("library_items_kind", sql`${t.kind} in ('archivo', 'enlace')`),
    check("library_items_audience", sql`${t.audience} in ('personal', 'familias')`),
    check(
      "library_items_content",
      sql`(${t.kind} = 'enlace' and ${t.url} is not null and ${t.storageKey} is null) or (${t.kind} = 'archivo' and ${t.storageKey} is not null and ${t.sizeBytes} > 0)`,
    ),
  ],
);

/**
 * Documentos del centro (circulares, actas, informes…) escritos en CONECTA. El contenido es el JSON
 * del editor, validado al guardar. Solo quien lo escribe lo edita; «personal» lo ve todo el personal.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    title: text("title").notNull(),
    template: text("template").$type<DocumentTemplate>().notNull(),
    content: jsonb("content").$type<DocContent>().notNull(),
    visibility: text("visibility").$type<DocumentVisibility>().notNull().default("privado"),
    authorUserId: uuid("author_user_id").notNull(),
    authorName: text("author_name").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_author_idx").on(t.schoolId, t.authorUserId),
    index("documents_shared_idx").on(t.schoolId, t.visibility),
    check("documents_visibility", sql`${t.visibility} in ('privado', 'personal')`),
  ],
);

/**
 * Calendario escolar: días o períodos sin clases del centro (feriados, vacaciones). Los marca la
 * secretaría o la dirección; en esos días no se espera asistencia ni planificación.
 */
export const schoolDaysOff = pgTable(
  "school_days_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    schoolYearId: uuid("school_year_id").notNull(),
    name: text("name").notNull(),
    kind: dayOffKindEnum("kind").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "school_days_off_year_fk",
      columns: [t.schoolId, t.schoolYearId],
      foreignColumns: [schoolYears.schoolId, schoolYears.id],
    }).onDelete("cascade"),
    index("school_days_off_dates_idx").on(t.schoolId, t.startsOn),
    check("school_days_off_dates", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** Ausencia de un maestro (vacaciones, enfermedad, etc.). Cancelar no borra: queda el historial. */
export const teacherLeaves = pgTable(
  "teacher_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    teacherUserId: uuid("teacher_user_id").notNull(),
    teacherName: text("teacher_name").notNull(),
    type: leaveTypeEnum("type").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("teacher_leaves_tenant_key").on(t.schoolId, t.id),
    index("teacher_leaves_teacher_idx").on(t.schoolId, t.teacherUserId),
    check("teacher_leaves_dates", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** Quién da una clase mientras su maestro titular está de licencia. */
export const substitutions = pgTable(
  "substitutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    leaveId: uuid("leave_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    substituteUserId: uuid("substitute_user_id").notNull(),
    substituteName: text("substitute_name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("substitutions_tenant_key").on(t.schoolId, t.id),
    // Una sola sustitución vigente por clase dentro de una licencia
    uniqueIndex("substitutions_active_unique")
      .on(t.leaveId, t.assignmentId)
      .where(sql`${t.cancelledAt} is null`),
    index("substitutions_substitute_idx").on(t.schoolId, t.substituteUserId),
    check("substitutions_dates", sql`${t.endsOn} >= ${t.startsOn}`),
    foreignKey({
      name: "substitutions_leave_fk",
      columns: [t.schoolId, t.leaveId],
      foreignColumns: [teacherLeaves.schoolId, teacherLeaves.id],
    }),
    foreignKey({
      name: "substitutions_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
  ],
);

// ───────────────────────────── Evaluación y asistencia ─────────────────────────────

/** Configuración de evaluación del centro (por ahora, la nota mínima de aprobación). */
export const evaluationSettings = pgTable("evaluation_settings", {
  schoolId: uuid("school_id").primaryKey(),
  passingGrade: integer("passing_grade").notNull().default(DEFAULT_PASSING_GRADE),
  updatedAt: updatedAt(),
});

/** Parciales del año lectivo, con la fecha en que deben estar completas las notas. */
export const gradingPeriods = pgTable(
  "grading_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    schoolYearId: uuid("school_year_id").notNull(),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    closesOn: date("closes_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("grading_periods_tenant_key").on(t.schoolId, t.id),
    unique("grading_periods_number_unique").on(t.schoolYearId, t.number),
    check("grading_periods_dates", sql`${t.startsOn} <= ${t.endsOn} and ${t.endsOn} <= ${t.closesOn}`),
    foreignKey({
      name: "grading_periods_school_year_fk",
      columns: [t.schoolId, t.schoolYearId],
      foreignColumns: [schoolYears.schoolId, schoolYears.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Actividad evaluada (tarea, trabajo, prueba, examen) de una clase en un parcial.
 * El id lo genera el dispositivo del maestro: una actividad creada sin internet se sincroniza
 * después sin duplicarse.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey(),
    schoolId: schoolId(),
    assignmentId: uuid("assignment_id").notNull(),
    periodId: uuid("period_id").notNull(),
    name: text("name").notNull(),
    maxPoints: numeric("max_points", { precision: 5, scale: 2, mode: "number" }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("activities_tenant_key").on(t.schoolId, t.id),
    index("activities_assignment_period_idx").on(t.assignmentId, t.periodId),
    check("activities_points", sql`${t.maxPoints} > 0 and ${t.maxPoints} <= 100`),
    foreignKey({
      name: "activities_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "activities_period_fk",
      columns: [t.schoolId, t.periodId],
      foreignColumns: [gradingPeriods.schoolId, gradingPeriods.id],
    }).onDelete("cascade"),
  ],
);

/** Nota de un alumno en una actividad. null = sin nota todavía. */
export const scores = pgTable(
  "scores",
  {
    schoolId: schoolId(),
    activityId: uuid("activity_id").notNull(),
    studentId: uuid("student_id").notNull(),
    points: numeric("points", { precision: 5, scale: 2, mode: "number" }),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "scores_pk", columns: [t.activityId, t.studentId] }),
    check("scores_points", sql`${t.points} is null or ${t.points} >= 0`),
    foreignKey({
      name: "scores_activity_fk",
      columns: [t.schoolId, t.activityId],
      foreignColumns: [activities.schoolId, activities.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "scores_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }),
  ],
);

/** Asistencia diaria por sección. */
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    schoolId: schoolId(),
    sectionId: uuid("section_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    studentId: uuid("student_id").notNull(),
    status: attendanceStatusEnum("status").notNull(),
    recordedByUserId: uuid("recorded_by_user_id").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "attendance_pk", columns: [t.sectionId, t.date, t.studentId] }),
    index("attendance_school_date_idx").on(t.schoolId, t.date),
    index("attendance_student_idx").on(t.studentId, t.date),
    foreignKey({
      name: "attendance_section_fk",
      columns: [t.schoolId, t.sectionId],
      foreignColumns: [sections.schoolId, sections.id],
    }),
    foreignKey({
      name: "attendance_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }),
  ],
);

/** Un incidente de conducta que reporta el personal (maestro, coordinación o dirección). */
export const conductIncidents = pgTable(
  "conduct_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    studentId: uuid("student_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    severity: conductSeverityEnum("severity").notNull(),
    category: conductCategoryEnum("category").notNull(),
    description: text("description").notNull(),
    reportedByUserId: uuid("reported_by_user_id").notNull(),
    reportedByName: text("reported_by_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conduct_incidents_tenant_key").on(t.schoolId, t.id),
    index("conduct_incidents_school_date_idx").on(t.schoolId, t.date),
    index("conduct_incidents_student_idx").on(t.schoolId, t.studentId, t.date),
    foreignKey({
      name: "conduct_incidents_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }),
  ],
);

/**
 * Lo que decidió el centro por un incidente: llamado de atención, citación, compromiso, suspensión o
 * expulsión. No se borra: si fue un error se anula y queda en el historial.
 */
export const conductMeasures = pgTable(
  "conduct_measures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    incidentId: uuid("incident_id").notNull(),
    kind: conductMeasureEnum("kind").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    notes: text("notes").notNull(),
    decidedByUserId: uuid("decided_by_user_id").notNull(),
    decidedByName: text("decided_by_name").notNull(),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: uuid("cancelled_by_user_id"),
    /** La familia la ve en su portal (en el llamado de atención se elige; lo demás, siempre). */
    notifyFamily: boolean("notify_family").notNull().default(true),
  },
  (t) => [
    index("conduct_measures_incident_idx").on(t.schoolId, t.incidentId),
    foreignKey({
      name: "conduct_measures_incident_fk",
      columns: [t.schoolId, t.incidentId],
      foreignColumns: [conductIncidents.schoolId, conductIncidents.id],
    }),
    // Solo la suspensión tiene último día, y nunca antes del primero.
    check(
      "conduct_measures_dates",
      sql`(${t.kind} = 'suspension' and ${t.endsOn} is not null and ${t.endsOn} >= ${t.startsOn}) or (${t.kind} <> 'suspension' and ${t.endsOn} is null)`,
    ),
  ],
);

/** Lo que se hizo con un alumno en riesgo: llamada a la familia, reunión, referido a orientación… */
export const studentFollowUps = pgTable(
  "student_follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    studentId: uuid("student_id").notNull(),
    kind: followUpKindEnum("kind").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    notes: text("notes").notNull(),
    authorUserId: uuid("author_user_id").notNull(),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("student_follow_ups_tenant_key").on(t.schoolId, t.id),
    index("student_follow_ups_student_idx").on(t.schoolId, t.studentId, t.date),
    foreignKey({
      name: "student_follow_ups_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  ],
);

/** Avisos del centro para el personal, las familias o una sección. Vencen solos. */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: announcementAudienceEnum("audience").notNull(),
    sectionId: uuid("section_id"),
    authorUserId: uuid("author_user_id").notNull(),
    authorName: text("author_name").notNull(),
    expiresOn: date("expires_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("announcements_tenant_key").on(t.schoolId, t.id),
    index("announcements_school_idx").on(t.schoolId, t.expiresOn),
    foreignKey({
      name: "announcements_section_fk",
      columns: [t.schoolId, t.sectionId],
      foreignColumns: [sections.schoolId, sections.id],
    }).onDelete("cascade"),
  ],
);

/** Horas de clase del centro (bloques): 1 = primera hora. */
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    schoolId: schoolId(),
    number: integer("number").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
  },
  (t) => [primaryKey({ name: "schedule_blocks_pk", columns: [t.schoolId, t.number] })],
);

/** Qué clase tiene cada sección en cada día (1 = lunes) y bloque. */
export const scheduleSlots = pgTable(
  "schedule_slots",
  {
    schoolId: schoolId(),
    sectionId: uuid("section_id").notNull(),
    weekday: integer("weekday").notNull(),
    block: integer("block").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "schedule_slots_pk", columns: [t.sectionId, t.weekday, t.block] }),
    index("schedule_slots_assignment_idx").on(t.assignmentId),
    check("schedule_slots_weekday", sql`${t.weekday} between 1 and 5`),
    foreignKey({
      name: "schedule_slots_section_fk",
      columns: [t.schoolId, t.sectionId],
      foreignColumns: [sections.schoolId, sections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "schedule_slots_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Traslado de un alumno a otro centro. Es el único dato que cruza de un centro a otro: el de origen
 * lo envía (con una copia de sus datos, responsables y notas) y el de destino lo recibe.
 */
export const studentTransfers = pgTable(
  "student_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromSchoolId: uuid("from_school_id").notNull(),
    fromSchoolName: text("from_school_name").notNull(),
    fromStudentId: uuid("from_student_id").notNull(),
    toSchoolId: uuid("to_school_id").notNull(),
    toSchoolName: text("to_school_name").notNull(),
    toStudentId: uuid("to_student_id"),
    status: transferStatusEnum("status").notNull().default("pendiente"),
    date: date("date", { mode: "string" }).notNull(),
    notes: text("notes"),
    snapshot: jsonb("snapshot").$type<TransferSnapshot>().notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (t) => [
    index("student_transfers_from_idx").on(t.fromSchoolId, t.status),
    index("student_transfers_to_idx").on(t.toSchoolId, t.status),
    // Un solo traslado pendiente por alumno.
    uniqueIndex("student_transfers_one_pending")
      .on(t.fromSchoolId, t.fromStudentId)
      .where(sql`${t.status} = 'pendiente'`),
    foreignKey({
      name: "student_transfers_from_student_fk",
      columns: [t.fromSchoolId, t.fromStudentId],
      foreignColumns: [students.schoolId, students.id],
    }),
  ],
);

/** Nota de recuperación de un alumno en una clase (cuando el promedio del año no alcanza). */
export const recoveryGrades = pgTable(
  "recovery_grades",
  {
    schoolId: schoolId(),
    assignmentId: uuid("assignment_id").notNull(),
    studentId: uuid("student_id").notNull(),
    score: numeric("score", { precision: 5, scale: 2, mode: "number" }).notNull(),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "recovery_grades_pk", columns: [t.assignmentId, t.studentId] }),
    check("recovery_grades_score", sql`${t.score} >= 0 and ${t.score} <= 100`),
    foreignKey({
      name: "recovery_grades_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "recovery_grades_student_fk",
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }),
  ],
);

/** Bitácora de cambios. Solo inserción. */
// ───────────────────────────── Planificación semanal ─────────────────────────────

/** Plantilla de planificación del centro (si no tiene, se usa la del Currículo Nacional Básico). */
export const planTemplates = pgTable(
  "plan_templates",
  {
    schoolId: uuid("school_id").primaryKey(),
    fields: jsonb("fields").$type<PlanField[]>().notNull(),
    deadlineDaysBefore: integer("deadline_days_before").notNull(),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [check("plan_templates_deadline", sql`${t.deadlineDaysBefore} between 0 and 14`)],
);

/**
 * Planificación de una clase en una semana. Guarda una copia de los campos de la plantilla con la que
 * se creó: si el centro cambia la plantilla, las planificaciones ya hechas no se rompen.
 */
export const lessonPlans = pgTable(
  "lesson_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    assignmentId: uuid("assignment_id").notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: planStatusEnum("status").notNull().default("borrador"),
    fields: jsonb("fields").$type<PlanField[]>().notNull(),
    content: jsonb("content").$type<PlanContent>().notNull().default({}),
    /** Sube con cada guardado: evita que dos ventanas se pisen sin darse cuenta. */
    version: integer("version").notNull().default(1),
    authorUserId: uuid("author_user_id").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewerUserId: uuid("reviewer_user_id"),
    reviewerName: text("reviewer_name"),
    reviewComment: text("review_comment"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("lesson_plans_tenant_key").on(t.schoolId, t.id),
    uniqueIndex("lesson_plans_assignment_week_key").on(t.assignmentId, t.weekStart),
    index("lesson_plans_school_week_idx").on(t.schoolId, t.weekStart),
    check("lesson_plans_monday", sql`extract(isodow from ${t.weekStart}) = 1`),
    foreignKey({
      name: "lesson_plans_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
  ],
);

/** Historial de cada planificación: quién la creó, guardó, envió, aprobó o devolvió. */
export const planEvents = pgTable(
  "plan_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    planId: uuid("plan_id").notNull(),
    action: planActionEnum("action").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    comment: text("comment"),
    version: integer("version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("plan_events_plan_idx").on(t.planId, t.createdAt),
    foreignKey({
      name: "plan_events_plan_fk",
      columns: [t.schoolId, t.planId],
      foreignColumns: [lessonPlans.schoolId, lessonPlans.id],
    }).onDelete("cascade"),
  ],
);

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

// ───────────────────────────── Aula virtual ─────────────────────────────

/** Ajustes del aula de una clase (asignación docente): el enlace de la clase en línea. */
export const virtualClasses = pgTable(
  "virtual_classes",
  {
    schoolId: schoolId(),
    assignmentId: uuid("assignment_id").notNull(),
    meetingUrl: text("meeting_url"),
    /** «Martes y jueves, 3:00 p. m.» */
    meetingNote: text("meeting_note"),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "virtual_classes_pk", columns: [t.assignmentId] }),
    foreignKey({
      name: "virtual_classes_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
  ],
);

/** Temas (con su explicación, en el orden del maestro) y avisos de una clase. */
export const classPosts = pgTable(
  "class_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    assignmentId: uuid("assignment_id").notNull(),
    kind: text("kind").$type<ClassPostKind>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    position: integer("position").notNull().default(0),
    authorUserId: uuid("author_user_id").notNull(),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("class_posts_tenant_key").on(t.schoolId, t.id),
    index("class_posts_assignment_idx").on(t.assignmentId, t.kind, t.position),
    check("class_posts_kind", sql`${t.kind} in ('tema', 'aviso')`),
    foreignKey({
      name: "class_posts_assignment_fk",
      columns: [t.schoolId, t.assignmentId],
      foreignColumns: [teachingAssignments.schoolId, teachingAssignments.id],
    }).onDelete("cascade"),
  ],
);

/** Materiales de un tema: archivos (en S3 o la carpeta de la demo), enlaces y videos de YouTube. */
export const classMaterials = pgTable(
  "class_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: schoolId(),
    assignmentId: uuid("assignment_id").notNull(),
    postId: uuid("post_id").notNull(),
    kind: text("kind").$type<ClassMaterialKind>().notNull(),
    title: text("title").notNull(),
    url: text("url"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key").unique(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("class_materials_post_idx").on(t.postId, t.createdAt),
    check("class_materials_kind", sql`${t.kind} in ('archivo', 'enlace', 'video')`),
    check(
      "class_materials_content",
      sql`(${t.kind} in ('enlace', 'video') and ${t.url} is not null and ${t.storageKey} is null) or (${t.kind} = 'archivo' and ${t.storageKey} is not null and ${t.sizeBytes} > 0)`,
    ),
    foreignKey({
      name: "class_materials_post_fk",
      columns: [t.schoolId, t.postId],
      foreignColumns: [classPosts.schoolId, classPosts.id],
    }).onDelete("cascade"),
  ],
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
export type TeacherLeave = typeof teacherLeaves.$inferSelect;
export type Substitution = typeof substitutions.$inferSelect;
export type GradingPeriod = typeof gradingPeriods.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type StudentFollowUp = typeof studentFollowUps.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type StudentTransfer = typeof studentTransfers.$inferSelect;
export type SchoolDayOff = typeof schoolDaysOff.$inferSelect;
export type SchoolDocument = typeof documents.$inferSelect;
export type LibraryItem = typeof libraryItems.$inferSelect;
export type ClassPost = typeof classPosts.$inferSelect;
export type ClassMaterial = typeof classMaterials.$inferSelect;
