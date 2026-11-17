import { badRequest, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type DisciplineDto,
  type DisciplineOverviewDto,
  type DisciplineStudentOption,
  disciplineInputSchema,
  disciplineKindsFor,
  type FamilyDisciplineDto,
} from "@escolar/shared";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { type DisciplineRecord, disciplineRecords, enrollments, students } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { rosterOf } from "../lib/evaluation";
import { childrenOf } from "../lib/family";
import { findCurrentYear, listAssignments, listSections } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
/** Lo reciente en la página de disciplina: los últimos 4 meses, hasta 200 registros. */
const RECENT_DAYS = 120;
const RECENT_LIMIT = 200;

/**
 * Disciplina: llamados de atención y medidas. Docentes anotan llamados y citaciones de sus propios
 * alumnos; coordinación también actas de compromiso; la suspensión y la expulsión, solo la
 * dirección. La expulsión retira la matrícula del año. La familia ve lo que se le avisó.
 */
export async function disciplineRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const staff = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const writers = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "docente")] };

  /** Alumnos de las secciones donde el docente da clases este año (con su sección). */
  async function teacherStudents(schoolId: string, userId: string): Promise<DisciplineStudentOption[]> {
    const year = await findCurrentYear(db, schoolId);
    if (!year) return [];
    const classes = await listAssignments(db, schoolId, { schoolYearId: year.id, teacherUserId: userId });
    const labels = new Map(classes.map((c) => [c.sectionId, c.sectionLabel]));
    const roster = await rosterOf(db, schoolId, [...labels.keys()]);
    return roster.map((r) => ({
      id: r.studentId,
      name: `${r.lastNames}, ${r.firstNames}`,
      sectionLabel: labels.get(r.sectionId) ?? "",
    }));
  }

  /** A quién puede ver o anotar quien pide: el docente, solo a sus alumnos; el resto, a todos. */
  async function scopeOf(request: FastifyRequest): Promise<Set<string> | null> {
    if (request.auth.role !== "docente") return null;
    const mine = await teacherStudents(tenantOf(request), request.auth.userId);
    return new Set(mine.map((s) => s.id));
  }

  /** Nombre y sección (del año vigente, aunque se haya retirado) de los alumnos de los registros. */
  async function describe(
    tx: DbOrTx,
    request: FastifyRequest,
    rows: DisciplineRecord[],
  ): Promise<DisciplineDto[]> {
    const schoolId = tenantOf(request);
    const ids = [...new Set(rows.map((r) => r.studentId))];
    if (ids.length === 0) return [];
    const year = await findCurrentYear(tx, schoolId);
    const [people, sections, enrolled] = await Promise.all([
      tx
        .select({ id: students.id, firstNames: students.firstNames, lastNames: students.lastNames })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), inArray(students.id, ids))),
      year ? listSections(tx, schoolId, year.id) : Promise.resolve([]),
      year
        ? tx
            .select({
              studentId: enrollments.studentId,
              sectionId: enrollments.sectionId,
              status: enrollments.status,
            })
            .from(enrollments)
            .where(
              and(
                eq(enrollments.schoolId, schoolId),
                eq(enrollments.schoolYearId, year.id),
                inArray(enrollments.studentId, ids),
              ),
            )
        : Promise.resolve([]),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, `${p.lastNames}, ${p.firstNames}`]));
    const labelOf = new Map(sections.map((s) => [s.id, s.label]));
    const sectionOf = new Map<string, string>();
    for (const e of enrolled) {
      // La matrícula activa manda; si no hay, la última retirada.
      if (e.status === "activa" || !sectionOf.has(e.studentId)) sectionOf.set(e.studentId, e.sectionId);
    }
    return rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: nameOf.get(r.studentId) ?? "Alumno",
      sectionLabel: labelOf.get(sectionOf.get(r.studentId) ?? "") ?? null,
      kind: r.kind,
      severity: r.severity,
      date: r.date,
      description: r.description,
      measure: r.measure,
      suspensionFrom: r.suspensionFrom,
      suspensionTo: r.suspensionTo,
      notifyFamily: r.notifyFamily,
      authorName: r.authorName,
      createdAt: r.createdAt.toISOString(),
      canDelete: request.auth.role === "admin" || r.authorUserId === request.auth.userId,
    }));
  }

  async function studentOrThrow(schoolId: string, id: string, scope: Set<string> | null) {
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, id)));
    if (!student || (scope && !scope.has(id))) throw notFound("Alumno no encontrado");
  }

  app.get("/discipline", staff, async (request): Promise<DisciplineOverviewDto> => {
    const schoolId = tenantOf(request);
    const kinds = [...disciplineKindsFor(request.auth.role)];
    const day = today();
    const since = new Date(`${day}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - RECENT_DAYS);
    let students: DisciplineStudentOption[] = [];
    let scope: Set<string> | null = null;
    if (request.auth.role === "docente") {
      students = await teacherStudents(schoolId, request.auth.userId);
      scope = new Set(students.map((s) => s.id));
    } else if (kinds.length > 0) {
      const year = await findCurrentYear(db, schoolId);
      if (year) {
        const sections = await listSections(db, schoolId, year.id);
        const labels = new Map(sections.map((s) => [s.id, s.label]));
        students = (await rosterOf(db, schoolId, [...labels.keys()])).map((r) => ({
          id: r.studentId,
          name: `${r.lastNames}, ${r.firstNames}`,
          sectionLabel: labels.get(r.sectionId) ?? "",
        }));
      }
    }
    if (scope && scope.size === 0) return { kinds, students, recent: [], activeSuspensions: [] };
    const inScope = scope ? inArray(disciplineRecords.studentId, [...scope]) : undefined;
    const [recent, suspensions] = await Promise.all([
      db
        .select()
        .from(disciplineRecords)
        .where(
          and(
            eq(disciplineRecords.schoolId, schoolId),
            gte(disciplineRecords.date, since.toISOString().slice(0, 10)),
            inScope,
          ),
        )
        .orderBy(desc(disciplineRecords.date), desc(disciplineRecords.createdAt))
        .limit(RECENT_LIMIT),
      db
        .select()
        .from(disciplineRecords)
        .where(
          and(
            eq(disciplineRecords.schoolId, schoolId),
            eq(disciplineRecords.kind, "suspension"),
            lte(disciplineRecords.suspensionFrom, day),
            gte(disciplineRecords.suspensionTo, day),
            inScope,
          ),
        )
        .orderBy(desc(disciplineRecords.suspensionTo)),
    ]);
    const described = await describe(db, request, [...recent, ...suspensions]);
    return {
      kinds,
      students,
      recent: described.slice(0, recent.length),
      activeSuspensions: described.slice(recent.length),
    };
  });

  app.get("/students/:id/discipline", staff, async (request): Promise<DisciplineDto[]> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await studentOrThrow(schoolId, id, await scopeOf(request));
    const rows = await db
      .select()
      .from(disciplineRecords)
      .where(and(eq(disciplineRecords.schoolId, schoolId), eq(disciplineRecords.studentId, id)))
      .orderBy(desc(disciplineRecords.date), desc(disciplineRecords.createdAt));
    return describe(db, request, rows);
  });

  app.post("/students/:id/discipline", writers, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(disciplineInputSchema, request.body);
    if (!disciplineKindsFor(request.auth.role).includes(input.kind)) {
      throw forbidden(
        input.kind === "suspension" || input.kind === "expulsion"
          ? "La suspensión y la expulsión solo las registra la dirección"
          : "Tu cargo no puede registrar esa medida",
      );
    }
    if (input.date > today())
      throw badRequest("La fecha no puede ser futura", {
        fields: [{ path: "date", message: "No puede ser futura" }],
      });
    await studentOrThrow(schoolId, id, await scopeOf(request));
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(disciplineRecords)
        .values({
          schoolId,
          studentId: id,
          kind: input.kind,
          severity: input.severity,
          date: input.date,
          description: input.description,
          measure: input.measure ?? null,
          suspensionFrom: input.suspensionFrom ?? null,
          suspensionTo: input.suspensionTo ?? null,
          notifyFamily: input.notifyFamily,
          authorUserId: request.auth.userId,
          authorName: request.auth.name,
        })
        .returning();
      if (!row) throw new Error("No se registró la medida");
      await audit(tx, request, {
        action: "student.discipline_recorded",
        entityType: "student",
        entityId: id,
        data: { kind: input.kind, severity: input.severity },
      });
      if (input.kind === "expulsion") {
        // Expulsado: se retira su matrícula del año, como en un traslado.
        const year = await findCurrentYear(tx, schoolId);
        if (year) {
          await tx
            .update(enrollments)
            .set({ status: "retirada", withdrawnOn: input.date, withdrawReason: "Expulsión" })
            .where(
              and(
                eq(enrollments.schoolId, schoolId),
                eq(enrollments.studentId, id),
                eq(enrollments.schoolYearId, year.id),
                eq(enrollments.status, "activa"),
              ),
            );
        }
        await audit(tx, request, { action: "student.expelled", entityType: "student", entityId: id });
      }
      return row;
    });
    const [dto] = await describe(db, request, [created]);
    return reply.status(201).send(dto);
  });

  /** Borrar un registro hecho por error: quien lo anotó o la dirección. Una expulsión no se deshace sola. */
  app.delete("/discipline/:id", writers, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(disciplineRecords)
      .where(and(eq(disciplineRecords.schoolId, schoolId), eq(disciplineRecords.id, id)));
    if (!row) throw notFound("Registro no encontrado");
    if (request.auth.role !== "admin" && row.authorUserId !== request.auth.userId)
      throw forbidden("Solo quien lo registró o la dirección lo puede borrar");
    await db.transaction(async (tx) => {
      await tx.delete(disciplineRecords).where(eq(disciplineRecords.id, id));
      await audit(tx, request, {
        action: "student.discipline_deleted",
        entityType: "student",
        entityId: row.studentId,
        data: { kind: row.kind, date: row.date },
      });
    });
    return reply.status(204).send();
  });

  /** La familia ve solo lo que se le avisó, de sus propios hijos. */
  app.get(
    "/family/children/:id/discipline",
    { preHandler: [app.authenticate, requireRole("padre")] },
    async (request): Promise<FamilyDisciplineDto[]> => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      if (!(await childrenOf(db, schoolId, request.auth.userId)).includes(id))
        throw notFound("Alumno no encontrado");
      const rows = await db
        .select()
        .from(disciplineRecords)
        .where(
          and(
            eq(disciplineRecords.schoolId, schoolId),
            eq(disciplineRecords.studentId, id),
            eq(disciplineRecords.notifyFamily, true),
          ),
        )
        .orderBy(desc(disciplineRecords.date), desc(disciplineRecords.createdAt));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        severity: r.severity,
        date: r.date,
        description: r.description,
        measure: r.measure,
        suspensionFrom: r.suspensionFrom,
        suspensionTo: r.suspensionTo,
      }));
    },
  );
}
