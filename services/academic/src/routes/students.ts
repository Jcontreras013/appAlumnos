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
  createStudentInputSchema,
  enrollInputSchema,
  guardianInputSchema,
  type StudentDetailDto,
  type StudentListItemDto,
  studentFieldsSchema,
  withdrawInputSchema,
} from "@escolar/shared";
import { and, asc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { enrollments, grades, guardians, sections, studentGuardians, students } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { enrollStudent } from "../lib/enroll";
import { countActive, findCurrentYear, getSection, lockSection, sectionLabel } from "../lib/queries";
import { findOrCreateGuardian, getStudentDetail, insertStudent, studentValues } from "../lib/students";

const idParams = z.object({ id: z.uuid() });
const guardianParams = z.object({ id: z.uuid(), guardianId: z.uuid() });
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sectionId: z.uuid().optional(),
  estado: z.enum(["todos", "matriculados", "sin_matricula", "retirados"]).default("todos"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Alumnos, responsables y matrícula. Escriben administración y secretaría. */
export async function studentRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const read = { preHandler: [app.authenticate, requireRole("admin", "secretaria", "coordinador")] };
  const write = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };

  app.get("/students", read, async (request): Promise<{ items: StudentListItemDto[]; total: number }> => {
    const schoolId = tenantOf(request);
    const query = parseOrThrow(listQuery, request.query);
    const year = await findCurrentYear(db, schoolId);
    const primaryLink = alias(studentGuardians, "primary_link");
    const primaryGuardian = alias(guardians, "primary_guardian");

    const filters: (SQL | undefined)[] = [eq(students.schoolId, schoolId)];
    if (query.q) {
      const term = `%${query.q.replace(/[%_]/g, "")}%`;
      const digits = query.q.replace(/\D/g, "");
      filters.push(
        or(
          ilike(sql`${students.firstNames} || ' ' || ${students.lastNames}`, term),
          ilike(sql`${students.lastNames} || ' ' || ${students.firstNames}`, term),
          digits.length >= 4 ? ilike(students.nationalId, `${digits}%`) : undefined,
        ),
      );
    }
    if (query.sectionId) filters.push(eq(enrollments.sectionId, query.sectionId));
    if (query.estado === "matriculados") filters.push(eq(enrollments.status, "activa"));
    if (query.estado === "retirados") filters.push(eq(enrollments.status, "retirada"));
    if (query.estado === "sin_matricula") filters.push(isNull(enrollments.id));

    const base = db
      .select({
        student: students,
        enrollment: enrollments,
        sectionName: sections.name,
        gradeName: grades.name,
        guardianName: primaryGuardian.fullName,
        guardianPhone: primaryGuardian.phone,
      })
      .from(students)
      .leftJoin(
        enrollments,
        and(
          eq(enrollments.studentId, students.id),
          // Sin año vigente no hay matrícula "actual" que mostrar
          year ? eq(enrollments.schoolYearId, year.id) : sql`false`,
        ),
      )
      .leftJoin(sections, eq(sections.id, enrollments.sectionId))
      .leftJoin(grades, eq(grades.id, sections.gradeId))
      .leftJoin(primaryLink, and(eq(primaryLink.studentId, students.id), eq(primaryLink.isPrimary, true)))
      .leftJoin(primaryGuardian, eq(primaryGuardian.id, primaryLink.guardianId))
      .where(and(...filters));

    const rows = await base
      .orderBy(asc(students.lastNames), asc(students.firstNames))
      .limit(query.limit)
      .offset(query.offset);
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(base.as("filtered"));

    return {
      total,
      items: rows.map((r) => ({
        id: r.student.id,
        firstNames: r.student.firstNames,
        lastNames: r.student.lastNames,
        nationalId: r.student.nationalId,
        enrollment:
          r.enrollment && r.gradeName && r.sectionName
            ? {
                id: r.enrollment.id,
                sectionId: r.enrollment.sectionId,
                sectionLabel: sectionLabel(r.gradeName, r.sectionName),
                status: r.enrollment.status,
              }
            : null,
        primaryGuardian: r.guardianName ? { fullName: r.guardianName, phone: r.guardianPhone } : null,
      })),
    };
  });

  app.get("/students/:id", read, async (request): Promise<StudentDetailDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return getStudentDetail(db, tenantOf(request), id);
  });

  /** Alta completa en una sola transacción: alumno + responsables + (opcional) matrícula. */
  app.post("/students", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(createStudentInputSchema, request.body);
    const studentId = await db.transaction(async (tx) => {
      const student = await insertStudent(tx, schoolId, input);
      const hasPrimary = input.guardians.some((g) => g.isPrimary);
      const reused: string[] = [];
      const linked = new Set<string>();
      for (const [index, g] of input.guardians.entries()) {
        const { guardian, reused: wasReused } = await findOrCreateGuardian(tx, schoolId, g);
        if (linked.has(guardian.id)) throw badRequest("El mismo responsable aparece dos veces");
        linked.add(guardian.id);
        if (wasReused) reused.push(guardian.fullName);
        await tx.insert(studentGuardians).values({
          schoolId,
          studentId: student.id,
          guardianId: guardian.id,
          relationship: g.relationship,
          isPrimary: hasPrimary ? g.isPrimary : index === 0,
        });
      }
      if (input.sectionId) {
        await enrollStudent(tx, {
          schoolId,
          studentId: student.id,
          sectionId: input.sectionId,
          today: today(),
        });
      }
      await audit(tx, request, {
        action: "student.created",
        entityType: "student",
        entityId: student.id,
        data: { enrolled: Boolean(input.sectionId), guardiansReused: reused },
      });
      return student.id;
    });
    return reply.status(201).send(await getStudentDetail(db, schoolId, studentId));
  });

  app.put("/students/:id", write, async (request): Promise<StudentDetailDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(studentFieldsSchema, request.body);
    try {
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(students)
          .set({ ...studentValues(input), updatedAt: new Date() })
          .where(and(eq(students.schoolId, schoolId), eq(students.id, id)))
          .returning({ id: students.id });
        if (!updated) throw notFound("Alumno no encontrado");
        await audit(tx, request, { action: "student.updated", entityType: "student", entityId: id });
      });
    } catch (err) {
      if (isUniqueViolation(err, "students_national_id_unique")) {
        throw conflict("Ya existe un alumno con ese número de identidad");
      }
      throw err;
    }
    return getStudentDetail(db, schoolId, id);
  });

  // ── Responsables ──
  app.post("/students/:id/guardians", write, async (request): Promise<StudentDetailDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(guardianInputSchema, request.body);
    await getStudentDetail(db, schoolId, id); // 404 si el alumno no es de este colegio
    await db.transaction(async (tx) => {
      const { guardian } = await findOrCreateGuardian(tx, schoolId, input);
      const [already] = await tx
        .select()
        .from(studentGuardians)
        .where(and(eq(studentGuardians.studentId, id), eq(studentGuardians.guardianId, guardian.id)));
      if (already) throw conflict(`${guardian.fullName} ya es responsable de este alumno`);
      if (input.isPrimary) {
        await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, id));
      }
      await tx.insert(studentGuardians).values({
        schoolId,
        studentId: id,
        guardianId: guardian.id,
        relationship: input.relationship,
        isPrimary: input.isPrimary,
      });
      await audit(tx, request, {
        action: "student.guardian_added",
        entityType: "student",
        entityId: id,
        data: { guardianId: guardian.id },
      });
    });
    return getStudentDetail(db, schoolId, id);
  });

  app.post("/students/:id/guardians/:guardianId/primary", write, async (request) => {
    const schoolId = tenantOf(request);
    const { id, guardianId } = parseOrThrow(guardianParams, request.params);
    await db.transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(studentGuardians)
        .where(
          and(
            eq(studentGuardians.schoolId, schoolId),
            eq(studentGuardians.studentId, id),
            eq(studentGuardians.guardianId, guardianId),
          ),
        );
      if (!link) throw notFound("Responsable no encontrado");
      await tx.update(studentGuardians).set({ isPrimary: false }).where(eq(studentGuardians.studentId, id));
      await tx
        .update(studentGuardians)
        .set({ isPrimary: true })
        .where(and(eq(studentGuardians.studentId, id), eq(studentGuardians.guardianId, guardianId)));
      await audit(tx, request, {
        action: "student.primary_guardian_changed",
        entityType: "student",
        entityId: id,
        data: { guardianId },
      });
    });
    return getStudentDetail(db, schoolId, id);
  });

  app.delete("/students/:id/guardians/:guardianId", write, async (request) => {
    const schoolId = tenantOf(request);
    const { id, guardianId } = parseOrThrow(guardianParams, request.params);
    const detail = await getStudentDetail(db, schoolId, id);
    const link = detail.guardians.find((g) => g.id === guardianId);
    if (!link) throw notFound("Responsable no encontrado");
    if (detail.guardians.length === 1) throw badRequest("El alumno debe tener al menos un responsable");
    if (link.isPrimary) throw badRequest("Primero marca a otro responsable como principal");
    await db.transaction(async (tx) => {
      await tx
        .delete(studentGuardians)
        .where(and(eq(studentGuardians.studentId, id), eq(studentGuardians.guardianId, guardianId)));
      await audit(tx, request, {
        action: "student.guardian_removed",
        entityType: "student",
        entityId: id,
        data: { guardianId },
      });
    });
    return getStudentDetail(db, schoolId, id);
  });

  // ── Matrícula ──
  app.post("/enrollments", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(enrollInputSchema, request.body);
    await getStudentDetail(db, schoolId, input.studentId); // 404 si el alumno no es de este colegio
    const { reactivated } = await db.transaction(async (tx) => {
      const result = await enrollStudent(tx, { schoolId, ...input, today: today() });
      await audit(tx, request, {
        action: result.reactivated ? "enrollment.reactivated" : "enrollment.created",
        entityType: "enrollment",
        entityId: result.enrollment.id,
        data: { studentId: input.studentId, sectionId: input.sectionId },
      });
      return result;
    });
    return reply.status(reactivated ? 200 : 201).send(await getStudentDetail(db, schoolId, input.studentId));
  });

  app.post("/enrollments/:id/withdraw", write, async (request): Promise<StudentDetailDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(withdrawInputSchema, request.body);
    const studentId = await db.transaction(async (tx) => {
      const [enrollment] = await tx
        .update(enrollments)
        .set({ status: "retirada", withdrawnOn: input.withdrawnOn, withdrawReason: input.reason })
        .where(
          and(eq(enrollments.schoolId, schoolId), eq(enrollments.id, id), eq(enrollments.status, "activa")),
        )
        .returning();
      if (!enrollment) throw notFound("Matrícula activa no encontrada");
      await audit(tx, request, {
        action: "enrollment.withdrawn",
        entityType: "enrollment",
        entityId: id,
        data: { reason: input.reason, withdrawnOn: input.withdrawnOn },
      });
      return enrollment.studentId;
    });
    return getStudentDetail(db, schoolId, studentId);
  });

  /** Cambio de sección dentro del mismo año lectivo (respeta el cupo de la sección destino). */
  app.post("/enrollments/:id/transfer", write, async (request): Promise<StudentDetailDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { sectionId } = parseOrThrow(z.object({ sectionId: z.uuid() }), request.body);
    const studentId = await db.transaction(async (tx) => {
      const [enrollment] = await tx
        .select()
        .from(enrollments)
        .where(
          and(eq(enrollments.schoolId, schoolId), eq(enrollments.id, id), eq(enrollments.status, "activa")),
        )
        .for("update");
      if (!enrollment) throw notFound("Matrícula activa no encontrada");
      const target = await lockSection(tx, schoolId, sectionId);
      if (target.schoolYearId !== enrollment.schoolYearId) {
        throw badRequest("La sección destino es de otro año lectivo");
      }
      if (target.id === enrollment.sectionId) throw badRequest("El alumno ya está en esa sección");
      const info = await getSection(tx, schoolId, target.id);
      if (target.capacity !== null && (await countActive(tx, target.id)) >= target.capacity) {
        throw conflict(`${info.label} está llena (cupo de ${target.capacity} alumnos)`);
      }
      await tx.update(enrollments).set({ sectionId: target.id }).where(eq(enrollments.id, id));
      await audit(tx, request, {
        action: "enrollment.transferred",
        entityType: "enrollment",
        entityId: id,
        data: { from: enrollment.sectionId, to: target.id },
      });
      return enrollment.studentId;
    });
    return getStudentDetail(db, schoolId, studentId);
  });
}
