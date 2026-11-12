import {
  conflict,
  isForeignKeyViolation,
  isUniqueViolation,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  type AssignmentDto,
  assignmentInputSchema,
  assignmentTeacherSchema,
  type GradeDto,
  gradeInputSchema,
  type SchoolYearDto,
  type SectionDto,
  type SubjectDto,
  schoolYearInputSchema,
  sectionInputSchema,
  sectionUpdateSchema,
  subjectInputSchema,
} from "@escolar/shared";
import { and, asc, count, desc, eq, gte, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activities,
  attendanceRecords,
  enrollments,
  grades,
  lessonPlans,
  schoolYears,
  sections,
  subjects,
  substitutions,
  teachingAssignments,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { ensureDefaultPeriods } from "../lib/evaluation";
import {
  findCurrentYear,
  getSection,
  listAssignments,
  listSections,
  requireCurrentYear,
  toGradeDto,
  toSchoolYearDto,
  toSubjectDto,
} from "../lib/queries";
import { requireTeacher } from "../lib/staff";

const idParams = z.object({ id: z.uuid() });
const yearQuery = z.object({ schoolYearId: z.uuid().optional() });

/** Lanza 409 con un mensaje claro si la inserción choca con una restricción UNIQUE. */
async function uniqueOr<T>(promise: Promise<T>, constraint: string, message: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (isUniqueViolation(err, constraint)) throw conflict(message);
    throw err;
  }
}

/** "1 sección", "3 secciones". */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "a", "a y b", "a, b y c". */
const joinEs = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;

/**
 * Año lectivo, grados, secciones, materias y asignación de docentes.
 *
 * Corregir es seguro: se puede renombrar todo, pero solo se elimina lo que todavía no tiene
 * alumnos, notas ni registros. Lo que ya se usó se explica en el mensaje en vez de borrarse en
 * cascada (las notas de una clase no se pueden perder por un clic).
 */
export async function structureRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const read = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const write = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };

  // ── Años lectivos ──
  app.get("/school-years", read, async (request): Promise<SchoolYearDto[]> => {
    const rows = await db
      .select()
      .from(schoolYears)
      .where(eq(schoolYears.schoolId, tenantOf(request)))
      .orderBy(desc(schoolYears.startsOn));
    return rows.map(toSchoolYearDto);
  });

  app.post("/school-years", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(schoolYearInputSchema, request.body);
    const year = await db.transaction(async (tx) => {
      // El primer año que se crea queda como vigente.
      const isCurrent = (await findCurrentYear(tx, schoolId)) === null;
      const [created] = await uniqueOr(
        tx
          .insert(schoolYears)
          .values({ schoolId, ...input, isCurrent })
          .returning(),
        "school_years_name_unique",
        `Ya existe el año lectivo "${input.name}"`,
      );
      if (!created) throw new Error("No se creó el año lectivo");
      // Cuatro parciales por defecto; coordinación puede ajustar las fechas.
      await ensureDefaultPeriods(tx, created);
      await audit(tx, request, {
        action: "school_year.created",
        entityType: "school_year",
        entityId: created.id,
      });
      return created;
    });
    return reply.status(201).send(toSchoolYearDto(year));
  });

  app.post("/school-years/:id/current", write, async (request): Promise<SchoolYearDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(schoolYears)
        .where(and(eq(schoolYears.schoolId, schoolId), eq(schoolYears.id, id)));
      if (!target) throw notFound("Año lectivo no encontrado");
      await tx.update(schoolYears).set({ isCurrent: false }).where(eq(schoolYears.schoolId, schoolId));
      const [updated] = await tx
        .update(schoolYears)
        .set({ isCurrent: true })
        .where(eq(schoolYears.id, id))
        .returning();
      await audit(tx, request, {
        action: "school_year.set_current",
        entityType: "school_year",
        entityId: id,
      });
      return toSchoolYearDto(updated ?? target);
    });
  });

  // ── Grados ──
  app.get("/grades", read, async (request): Promise<GradeDto[]> => {
    const rows = await db
      .select()
      .from(grades)
      .where(eq(grades.schoolId, tenantOf(request)))
      .orderBy(asc(grades.sortOrder), asc(grades.name));
    return rows.map(toGradeDto);
  });

  app.post("/grades", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(gradeInputSchema, request.body);
    const [grade] = await uniqueOr(
      db
        .insert(grades)
        .values({ schoolId, ...input })
        .returning(),
      "grades_name_unique",
      `Ya existe el grado "${input.name}"`,
    );
    if (!grade) throw new Error("No se creó el grado");
    return reply.status(201).send(toGradeDto(grade));
  });

  app.put("/grades/:id", write, async (request): Promise<GradeDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(gradeInputSchema, request.body);
    return db.transaction(async (tx) => {
      const [updated] = await uniqueOr(
        tx
          .update(grades)
          .set(input)
          .where(and(eq(grades.schoolId, schoolId), eq(grades.id, id)))
          .returning(),
        "grades_name_unique",
        `Ya existe el grado "${input.name}"`,
      );
      if (!updated) throw notFound("Grado no encontrado");
      await audit(tx, request, { action: "grade.updated", entityType: "grade", entityId: id, data: input });
      return toGradeDto(updated);
    });
  });

  app.delete("/grades/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const [grade] = await tx
        .select()
        .from(grades)
        .where(and(eq(grades.schoolId, schoolId), eq(grades.id, id)));
      if (!grade) throw notFound("Grado no encontrado");
      const [used] = await tx
        .select({ n: count() })
        .from(sections)
        .where(and(eq(sections.schoolId, schoolId), eq(sections.gradeId, id)));
      if (used?.n) {
        throw conflict(
          `${grade.name} tiene ${plural(used.n, "sección", "secciones")} (de este u otro año lectivo). Elimina primero sus secciones.`,
        );
      }
      await tx.delete(grades).where(and(eq(grades.schoolId, schoolId), eq(grades.id, id)));
      await audit(tx, request, {
        action: "grade.deleted",
        entityType: "grade",
        entityId: id,
        data: { name: grade.name },
      });
    });
    return reply.status(204).send();
  });

  // ── Secciones ──
  app.get("/sections", read, async (request): Promise<SectionDto[]> => {
    const schoolId = tenantOf(request);
    const { schoolYearId } = parseOrThrow(yearQuery, request.query);
    const yearId = schoolYearId ?? (await findCurrentYear(db, schoolId))?.id;
    return yearId ? listSections(db, schoolId, yearId) : [];
  });

  app.post("/sections", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(sectionInputSchema, request.body);
    const [year] = await db
      .select({ id: schoolYears.id })
      .from(schoolYears)
      .where(and(eq(schoolYears.schoolId, schoolId), eq(schoolYears.id, input.schoolYearId)));
    const [grade] = await db
      .select({ id: grades.id })
      .from(grades)
      .where(and(eq(grades.schoolId, schoolId), eq(grades.id, input.gradeId)));
    if (!year) throw notFound("Año lectivo no encontrado");
    if (!grade) throw notFound("Grado no encontrado");

    const [section] = await uniqueOr(
      db
        .insert(sections)
        .values({ schoolId, ...input })
        .returning(),
      "sections_name_unique",
      `Ya existe la sección "${input.name}" en ese grado para ese año`,
    );
    if (!section) throw new Error("No se creó la sección");
    return reply.status(201).send(await getSection(db, schoolId, section.id));
  });

  app.put("/sections/:id", write, async (request): Promise<SectionDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(sectionUpdateSchema, request.body);
    const before = await getSection(db, schoolId, id);
    if (input.capacity !== null && input.capacity < before.enrolledCount) {
      throw conflict(
        `${before.label} tiene ${plural(before.enrolledCount, "alumno", "alumnos")}: el cupo no puede ser menor.`,
      );
    }
    await db.transaction(async (tx) => {
      await uniqueOr(
        tx
          .update(sections)
          .set(input)
          .where(and(eq(sections.schoolId, schoolId), eq(sections.id, id))),
        "sections_name_unique",
        `Ya existe la sección "${input.name}" en ese grado para ese año`,
      );
      await audit(tx, request, {
        action: "section.updated",
        entityType: "section",
        entityId: id,
        data: { before: { name: before.name, capacity: before.capacity }, after: input },
      });
    });
    return getSection(db, schoolId, id);
  });

  app.delete("/sections/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const section = await getSection(db, schoolId, id);
    const [[enrolled], [classes], [days]] = await Promise.all([
      db
        .select({ n: count() })
        .from(enrollments)
        .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.sectionId, id))),
      db
        .select({ n: count() })
        .from(teachingAssignments)
        .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.sectionId, id))),
      db
        .select({ n: count() })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.sectionId, id))),
    ]);
    const reasons = [
      enrolled?.n ? plural(enrolled.n, "alumno matriculado", "alumnos matriculados") : null,
      classes?.n ? plural(classes.n, "clase asignada", "clases asignadas") : null,
      days?.n ? "asistencia registrada" : null,
    ].filter((r): r is string => r !== null);
    if (reasons.length) {
      const hint = enrolled?.n
        ? " Para corregir el nombre o el cupo, edítala; para moverla de grado, pasa a sus alumnos a otra sección."
        : " Quita primero sus clases.";
      throw conflict(`${section.label} no se puede eliminar: tiene ${joinEs(reasons)}.${hint}`);
    }
    try {
      await db.transaction(async (tx) => {
        await tx.delete(sections).where(and(eq(sections.schoolId, schoolId), eq(sections.id, id)));
        await audit(tx, request, {
          action: "section.deleted",
          entityType: "section",
          entityId: id,
          data: { label: section.label },
        });
      });
    } catch (err) {
      // Algo la empezó a usar entre la revisión y el borrado.
      if (isForeignKeyViolation(err))
        throw conflict(`${section.label} ya tiene registros: no se puede eliminar.`);
      throw err;
    }
    return reply.status(204).send();
  });

  // ── Materias ──
  app.get("/subjects", read, async (request): Promise<SubjectDto[]> => {
    const rows = await db
      .select()
      .from(subjects)
      .where(eq(subjects.schoolId, tenantOf(request)))
      .orderBy(asc(subjects.name));
    return rows.map(toSubjectDto);
  });

  app.post("/subjects", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(subjectInputSchema, request.body);
    const [subject] = await uniqueOr(
      db
        .insert(subjects)
        .values({ schoolId, ...input })
        .returning(),
      "subjects_name_unique",
      `Ya existe la materia "${input.name}"`,
    );
    if (!subject) throw new Error("No se creó la materia");
    return reply.status(201).send(toSubjectDto(subject));
  });

  app.put("/subjects/:id", write, async (request): Promise<SubjectDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(subjectInputSchema, request.body);
    return db.transaction(async (tx) => {
      const [updated] = await uniqueOr(
        tx
          .update(subjects)
          .set(input)
          .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, id)))
          .returning(),
        "subjects_name_unique",
        `Ya existe la materia "${input.name}"`,
      );
      if (!updated) throw notFound("Materia no encontrada");
      await audit(tx, request, {
        action: "subject.updated",
        entityType: "subject",
        entityId: id,
        data: input,
      });
      return toSubjectDto(updated);
    });
  });

  app.delete("/subjects/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const [subject] = await tx
        .select()
        .from(subjects)
        .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, id)));
      if (!subject) throw notFound("Materia no encontrada");
      const [used] = await tx
        .select({ n: count() })
        .from(teachingAssignments)
        .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.subjectId, id)));
      if (used?.n) {
        throw conflict(
          `${subject.name} se da en ${plural(used.n, "sección", "secciones")} (de este u otro año lectivo). Quita primero esas clases.`,
        );
      }
      await tx.delete(subjects).where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, id)));
      await audit(tx, request, {
        action: "subject.deleted",
        entityType: "subject",
        entityId: id,
        data: { name: subject.name },
      });
    });
    return reply.status(204).send();
  });

  // ── Docentes por materia y sección ──
  app.get("/assignments", read, async (request): Promise<AssignmentDto[]> => {
    const schoolId = tenantOf(request);
    const { schoolYearId } = parseOrThrow(yearQuery, request.query);
    const yearId = schoolYearId ?? (await findCurrentYear(db, schoolId))?.id;
    return yearId ? listAssignments(db, schoolId, { schoolYearId: yearId }) : [];
  });

  app.get("/me/assignments", read, async (request): Promise<AssignmentDto[]> => {
    const schoolId = tenantOf(request);
    const year = await findCurrentYear(db, schoolId);
    return year
      ? listAssignments(db, schoolId, { schoolYearId: year.id, teacherUserId: request.auth.userId })
      : [];
  });

  app.post("/assignments", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(assignmentInputSchema, request.body);
    const section = await getSection(db, schoolId, input.sectionId);
    const [subject] = await db
      .select()
      .from(subjects)
      .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, input.subjectId)));
    if (!subject) throw notFound("Materia no encontrada");

    // El docente se valida en identity con el token de quien hace la petición: debe existir,
    // ser de este colegio y tener un rol que dé clases.
    const teacher = await requireTeacher(identity, request, input.teacherUserId);

    const assignment = await db.transaction(async (tx) => {
      const [created] = await uniqueOr(
        tx
          .insert(teachingAssignments)
          .values({
            schoolId,
            sectionId: section.id,
            subjectId: subject.id,
            teacherUserId: teacher.id,
            teacherName: teacher.name,
          })
          .returning(),
        "assignments_section_subject_unique",
        `${subject.name} ya tiene docente asignado en ${section.label}`,
      );
      if (!created) throw new Error("No se creó la asignación");
      await audit(tx, request, {
        action: "assignment.created",
        entityType: "assignment",
        entityId: created.id,
        data: { section: section.label, subject: subject.name, teacher: teacher.name },
      });
      return created;
    });
    const [dto] = (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId })).filter(
      (a) => a.id === assignment.id,
    );
    return reply.status(201).send(dto);
  });

  /**
   * Cambiar de docente una clase: sus actividades, notas y planificaciones se quedan con la clase
   * y pasan a la persona nueva. Es lo que se hace cuando un maestro se traslada o renuncia.
   */
  app.put("/assignments/:id", write, async (request): Promise<AssignmentDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { teacherUserId } = parseOrThrow(assignmentTeacherSchema, request.body);
    const [assignment] = await db
      .select()
      .from(teachingAssignments)
      .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, id)));
    if (!assignment) throw notFound("Asignación no encontrada");
    const teacher = await requireTeacher(identity, request, teacherUserId);
    if (teacher.id !== assignment.teacherUserId) {
      const [pending] = await db
        .select({ n: count() })
        .from(substitutions)
        .where(
          and(
            eq(substitutions.schoolId, schoolId),
            eq(substitutions.assignmentId, id),
            isNull(substitutions.cancelledAt),
            gte(substitutions.endsOn, today()),
          ),
        );
      if (pending?.n) {
        throw conflict(
          "Esta clase tiene una sustitución vigente o programada. Cancélala en Licencias antes de cambiar el docente.",
        );
      }
      await db.transaction(async (tx) => {
        await tx
          .update(teachingAssignments)
          .set({ teacherUserId: teacher.id, teacherName: teacher.name })
          .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, id)));
        await audit(tx, request, {
          action: "assignment.teacher_changed",
          entityType: "assignment",
          entityId: id,
          data: { from: assignment.teacherName, to: teacher.name },
        });
      });
    }
    const [section] = await db
      .select({ schoolYearId: sections.schoolYearId })
      .from(sections)
      .where(and(eq(sections.schoolId, schoolId), eq(sections.id, assignment.sectionId)));
    const [dto] = (await listAssignments(db, schoolId, { schoolYearId: section?.schoolYearId ?? "" })).filter(
      (a) => a.id === id,
    );
    if (!dto) throw notFound("Asignación no encontrada");
    return dto;
  });

  /** Quitar una clase solo si todavía no tiene trabajo: borrarla borraría sus notas. */
  app.delete("/assignments/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(teachingAssignments)
        .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, id)))
        .for("update");
      if (!assignment) throw notFound("Asignación no encontrada");
      const [[work], [plans]] = await Promise.all([
        tx
          .select({ n: count() })
          .from(activities)
          .where(and(eq(activities.schoolId, schoolId), eq(activities.assignmentId, id))),
        tx
          .select({ n: count() })
          .from(lessonPlans)
          .where(and(eq(lessonPlans.schoolId, schoolId), eq(lessonPlans.assignmentId, id))),
      ]);
      const reasons = [
        work?.n ? plural(work.n, "actividad evaluada", "actividades evaluadas") : null,
        plans?.n ? plural(plans.n, "planificación", "planificaciones") : null,
      ].filter((r): r is string => r !== null);
      if (reasons.length) {
        throw conflict(
          `Esta clase ya tiene ${joinEs(reasons)}; quitarla las borraría. Para que la dé otra persona, usa "Cambiar docente".`,
        );
      }
      await tx
        .delete(teachingAssignments)
        .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, id)));
      await audit(tx, request, {
        action: "assignment.deleted",
        entityType: "assignment",
        entityId: id,
        data: { teacher: assignment.teacherName },
      });
    });
    return reply.status(204).send();
  });

  // Atajo para pantallas que solo necesitan saber si ya hay un año vigente.
  app.get("/school-years/current", read, async (request): Promise<SchoolYearDto> => {
    return toSchoolYearDto(await requireCurrentYear(db, tenantOf(request)));
  });
}
