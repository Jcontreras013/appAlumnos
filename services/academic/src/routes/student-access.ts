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
  type FamilyAccountDto,
  type FamilyChildDto,
  portalAccessInputSchema,
  type SectionStudentAccessDto,
  type StudentAccessDto,
} from "@escolar/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { enrollments, grades, sections, students } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { familyChild, studentOf } from "../lib/family";
import { bearerOf } from "../lib/identity-client";
import { findCurrentYear, getSection, sectionLabel } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
type Student = typeof students.$inferSelect;

async function studentOrThrow(db: DbOrTx, schoolId: string, id: string) {
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, id)));
  if (!student) throw notFound("Alumno no encontrado");
  return student;
}

/** Grado y sección del año vigente de cada alumno (para la carta de acceso). */
async function currentSections(db: DbOrTx, schoolId: string, studentIds: string[]) {
  const year = await findCurrentYear(db, schoolId);
  if (!year || !studentIds.length) return new Map<string, string>();
  const rows = await db
    .select({ studentId: enrollments.studentId, gradeName: grades.name, sectionName: sections.name })
    .from(enrollments)
    .innerJoin(sections, eq(sections.id, enrollments.sectionId))
    .innerJoin(grades, eq(grades.id, sections.gradeId))
    .where(
      and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.schoolYearId, year.id),
        eq(enrollments.status, "activa"),
        inArray(enrollments.studentId, studentIds),
      ),
    );
  return new Map(rows.map((r) => [r.studentId, sectionLabel(r.gradeName, r.sectionName)]));
}

const fullName = (s: Pick<Student, "firstNames" | "lastNames">) => `${s.firstNames} ${s.lastNames}`;

/**
 * Cuentas de los alumnos para el aula virtual. Como con las familias, las da la secretaría o la
 * dirección desde la ficha del alumno (o a toda una sección de una vez): identity crea la cuenta y el
 * alumno entra con su identidad (o su correo) y una contraseña temporal que cambia al entrar.
 */
export async function studentAccessRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const office = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };
  const student = { preHandler: [app.authenticate, requireRole("estudiante")] };

  async function link(request: FastifyRequest, row: Student, account: FamilyAccountDto) {
    await db.transaction(async (tx) => {
      await tx
        .update(students)
        .set({ userId: account.userId, updatedAt: new Date() })
        .where(eq(students.id, row.id));
      await audit(tx, request, {
        action: "student.account_granted",
        entityType: "student",
        entityId: row.id,
        data: { userId: account.userId, linkedExisting: account.linkedExisting },
      });
    });
  }

  async function toDto(schoolId: string, row: Student, account: FamilyAccountDto): Promise<StudentAccessDto> {
    const labels = await currentSections(db, schoolId, [row.id]);
    return {
      ...account,
      studentId: row.id,
      studentName: fullName(row),
      sectionLabel: labels.get(row.id) ?? null,
    };
  }

  app.post("/students/:id/student-access", office, async (request): Promise<StudentAccessDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(portalAccessInputSchema, request.body ?? {});
    let row = await studentOrThrow(db, schoolId, id);
    const nationalId = input.nationalId ?? row.nationalId ?? undefined;
    const email = input.email ?? row.email ?? undefined;
    if (!nationalId && !email) {
      throw badRequest("Para darle su cuenta, escribe la identidad o el correo del alumno", {
        fields: [{ path: "nationalId", message: "Escribe la identidad o el correo" }],
      });
    }
    // Lo que se escribe aquí queda también en la ficha del alumno.
    if ((input.nationalId && !row.nationalId) || (input.email && !row.email)) {
      try {
        const [updated] = await db
          .update(students)
          .set({ nationalId: nationalId ?? null, email: email ?? null, updatedAt: new Date() })
          .where(eq(students.id, row.id))
          .returning();
        if (updated) row = updated;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("Ya hay otro alumno con esa identidad en el centro");
        throw err;
      }
    }
    const account = await identity.createStudentAccount(bearerOf(request), {
      name: fullName(row),
      nationalId,
      email,
    });
    try {
      await link(request, row, account);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Esa cuenta ya es de otro alumno del centro");
      throw err;
    }
    return toDto(schoolId, row, account);
  });

  app.post("/students/:id/student-access/reset", office, async (request): Promise<StudentAccessDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const row = await studentOrThrow(db, schoolId, id);
    if (!row.userId) throw badRequest("Este alumno todavía no tiene su cuenta");
    const account = await identity.resetStudentPassword(bearerOf(request), row.userId);
    await audit(db, request, { action: "student.account_reset", entityType: "student", entityId: id });
    return toDto(schoolId, row, account);
  });

  app.delete("/students/:id/student-access", office, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const row = await studentOrThrow(db, schoolId, id);
    if (row.userId) {
      await identity.revokeStudentAccount(bearerOf(request), row.userId);
      await db.transaction(async (tx) => {
        await tx.update(students).set({ userId: null, updatedAt: new Date() }).where(eq(students.id, id));
        await audit(tx, request, { action: "student.account_revoked", entityType: "student", entityId: id });
      });
    }
    return reply.status(204).send();
  });

  /**
   * Cuentas para toda una sección de una vez: a cada alumno activo que todavía no tiene. Los que no
   * tienen identidad ni correo en su ficha se informan para completarla.
   */
  app.post("/sections/:id/student-access", office, async (request): Promise<SectionStudentAccessDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const section = await getSection(db, schoolId, id);
    const roster = await db
      .select({ student: students })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.sectionId, section.id),
          eq(enrollments.status, "activa"),
        ),
      )
      .orderBy(asc(students.lastNames), asc(students.firstNames));
    const result: SectionStudentAccessDto = { created: [], alreadyActive: 0, skipped: [] };
    for (const { student: row } of roster) {
      if (row.userId) {
        result.alreadyActive++;
        continue;
      }
      if (!row.nationalId && !row.email) {
        result.skipped.push({ studentId: row.id, studentName: fullName(row) });
        continue;
      }
      const account = await identity.createStudentAccount(bearerOf(request), {
        name: fullName(row),
        nationalId: row.nationalId ?? undefined,
        email: row.nationalId ? undefined : (row.email ?? undefined),
      });
      try {
        await link(request, row, account);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        result.skipped.push({ studentId: row.id, studentName: fullName(row) });
        continue;
      }
      result.created.push({
        ...account,
        studentId: row.id,
        studentName: fullName(row),
        sectionLabel: section.label,
      });
    }
    return result;
  });

  // ── Lo que ve el alumno ──
  /** Sus notas, asistencia y tareas de la semana: lo mismo que ve su familia. */
  app.get("/student/me", student, async (request): Promise<FamilyChildDto> => {
    const schoolId = tenantOf(request);
    const studentId = await studentOf(db, schoolId, request.auth.userId);
    if (!studentId) throw notFound("Tu cuenta no está ligada a un alumno del centro");
    return familyChild(db, schoolId, studentId, today());
  });
}
