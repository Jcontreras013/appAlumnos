import {
  badRequest,
  conflict,
  isUniqueViolation,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  type AssignmentDto,
  assignmentInputSchema,
  type GradeDto,
  gradeInputSchema,
  type SchoolYearDto,
  type SectionDto,
  type SubjectDto,
  schoolYearInputSchema,
  sectionInputSchema,
  subjectInputSchema,
} from "@escolar/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { grades, schoolYears, sections, subjects, teachingAssignments } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
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

/** Año lectivo, grados, secciones, materias y asignación de docentes. */
export async function structureRoutes(app: FastifyInstance, { db, identity }: AcademicDeps) {
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
    const bearer = (request.headers.authorization ?? "").slice("Bearer ".length);
    const teacher = await identity.getUser(bearer, input.teacherUserId);
    if (!teacher?.active || !["docente", "coordinador"].includes(teacher.role)) {
      throw badRequest("El docente no existe en tu colegio o no está activo");
    }

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

  app.delete("/assignments/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(teachingAssignments)
        .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, id)))
        .returning();
      if (!deleted) throw notFound("Asignación no encontrada");
      await audit(tx, request, {
        action: "assignment.deleted",
        entityType: "assignment",
        entityId: id,
        data: { teacher: deleted.teacherName },
      });
    });
    return reply.status(204).send();
  });

  // Atajo para pantallas que solo necesitan saber si ya hay un año vigente.
  app.get("/school-years/current", read, async (request): Promise<SchoolYearDto> => {
    return toSchoolYearDto(await requireCurrentYear(db, tenantOf(request)));
  });
}
