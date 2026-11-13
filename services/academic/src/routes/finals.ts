import { badRequest, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type PromotionRowDto,
  type PromotionSummaryDto,
  promotionInputSchema,
  recoveriesInputSchema,
  type SectionFinalsDto,
} from "@escolar/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { enrollments, recoveryGrades, schoolYears } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { enrollStudent } from "../lib/enroll";
import { canGrade } from "../lib/evaluation";
import { sectionFinals } from "../lib/finals";
import { findCurrentYear, getSection, listAssignments } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });

/**
 * Fin de año: notas finales por sección, recuperación de quienes no alcanzan la nota mínima y paso
 * de cada alumno al año siguiente (promovido, repite o egresa), con la decisión final de la dirección.
 */
export async function finalRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const read = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const grade = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "docente")] };

  app.get("/sections/:id/finals", read, async (request): Promise<SectionFinalsDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const section = await getSection(db, schoolId, id);
    if (request.auth.role === "docente") {
      const mine = (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId })).some(
        (a) => a.sectionId === id && a.teacherUserId === request.auth.userId,
      );
      if (!mine) throw notFound("Sección no encontrada");
    }
    return sectionFinals(db, schoolId, id);
  });

  /** Notas de recuperación de una clase (vacío = se quita). Solo para quien no aprobó con el promedio. */
  app.put("/assignments/:id/recoveries", grade, async (request): Promise<SectionFinalsDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { entries } = parseOrThrow(recoveriesInputSchema, request.body);
    const year = await findCurrentYear(db, schoolId);
    const assignment = year
      ? (await listAssignments(db, schoolId, { schoolYearId: year.id })).find((a) => a.id === id)
      : undefined;
    if (!assignment) throw notFound("Clase no encontrada");
    if (!(await canGrade(db, request.auth, assignment, today()))) throw notFound("Clase no encontrada");
    const finals = await sectionFinals(db, schoolId, assignment.sectionId);
    for (const e of entries) {
      const subject = finals.students
        .find((s) => s.studentId === e.studentId)
        ?.subjects.find((s) => s.assignmentId === id);
      if (!subject) throw badRequest("Ese alumno no está en esta clase");
      if (e.score !== null && (subject.average === null || subject.average >= finals.passingGrade)) {
        throw badRequest("La recuperación es solo para quien terminó el año sin alcanzar la nota mínima");
      }
    }
    await db.transaction(async (tx) => {
      for (const e of entries) {
        const key = and(eq(recoveryGrades.assignmentId, id), eq(recoveryGrades.studentId, e.studentId));
        if (e.score === null) {
          await tx.delete(recoveryGrades).where(key);
        } else {
          await tx
            .insert(recoveryGrades)
            .values({
              schoolId,
              assignmentId: id,
              studentId: e.studentId,
              score: e.score,
              updatedByUserId: request.auth.userId,
            })
            .onConflictDoUpdate({
              target: [recoveryGrades.assignmentId, recoveryGrades.studentId],
              set: { score: e.score, updatedByUserId: request.auth.userId, updatedAt: new Date() },
            });
        }
      }
      await audit(tx, request, {
        action: "recovery.recorded",
        entityType: "assignment",
        entityId: id,
        data: { subject: assignment.subjectName, students: entries.length },
      });
    });
    return sectionFinals(db, schoolId, assignment.sectionId);
  });

  /**
   * Paso al año siguiente. Con `dryRun` solo muestra qué pasaría con cada alumno; al confirmar,
   * matricula a cada uno en su sección del año nuevo (los de último grado egresan).
   */
  app.post(
    "/promotion",
    { preHandler: [app.authenticate, requireRole("admin")] },
    async (request): Promise<PromotionSummaryDto> => {
      const schoolId = tenantOf(request);
      const input = parseOrThrow(promotionInputSchema, request.body);
      const current = await findCurrentYear(db, schoolId);
      if (!current) throw badRequest("No hay un año lectivo vigente");
      if (input.toSchoolYearId === current.id)
        throw badRequest("Elige el año lectivo siguiente, no el vigente");
      const [next] = await db
        .select()
        .from(schoolYears)
        .where(and(eq(schoolYears.schoolId, schoolId), eq(schoolYears.id, input.toSchoolYearId)));
      if (!next) throw notFound("Año lectivo no encontrado");
      if (next.startsOn <= current.startsOn)
        throw badRequest("El año siguiente debe empezar después del vigente");

      const overrides = new Map(input.overrides.map((o) => [o.studentId, o.decision]));
      const rows: Array<PromotionRowDto & { toSectionId: string | null }> = [];
      for (const map of input.sections) {
        const from = await getSection(db, schoolId, map.fromSectionId);
        if (from.schoolYearId !== current.id)
          throw badRequest("Las secciones de origen deben ser del año vigente");
        const targets = await Promise.all(
          [map.promotedToSectionId, map.repeatToSectionId].map(async (sid) => {
            if (!sid) return null;
            const s = await getSection(db, schoolId, sid);
            if (s.schoolYearId !== next.id)
              throw badRequest("Las secciones de destino deben ser del año siguiente");
            return s;
          }),
        );
        const [promotedTo, repeatTo] = targets;
        const finals = await sectionFinals(db, schoolId, from.id);
        for (const kid of finals.students) {
          const decision = overrides.get(kid.studentId) ?? kid.proposal;
          const base = { studentId: kid.studentId, name: kid.name, fromSectionLabel: from.label };
          if (decision === "pendiente") {
            rows.push({
              ...base,
              decision,
              toSectionLabel: null,
              toSectionId: null,
              problem: "Faltan notas: decide si promueve o repite",
            });
          } else if (decision === "promovido" && !promotedTo) {
            rows.push({
              ...base,
              decision: "egresa",
              toSectionLabel: null,
              toSectionId: null,
              problem: null,
            });
          } else {
            const to = decision === "promovido" ? promotedTo : repeatTo;
            rows.push({
              ...base,
              decision,
              toSectionLabel: to?.label ?? null,
              toSectionId: to?.id ?? null,
              problem: to ? null : "Elige la sección del año siguiente para quienes repiten",
            });
          }
        }
      }

      // Quien ya está matriculado en el año nuevo no se toca.
      for (const row of rows) {
        if (!row.toSectionId) continue;
        const [already] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(eq(enrollments.studentId, row.studentId), eq(enrollments.schoolYearId, next.id)));
        if (already) row.problem = "Ya está matriculado en el año siguiente";
      }

      let enrolled = 0;
      // Fechas en texto (AAAA-MM-DD): la matrícula cuenta desde el inicio del año nuevo, o desde hoy.
      const enrollOn = [next.startsOn, today()].sort().at(-1) as string;
      if (!input.dryRun) {
        for (const row of rows) {
          if (row.problem || !row.toSectionId) continue;
          try {
            await db.transaction((tx) =>
              enrollStudent(tx, {
                schoolId,
                studentId: row.studentId,
                sectionId: row.toSectionId as string,
                today: enrollOn,
              }),
            );
            enrolled++;
          } catch (err) {
            row.problem = err instanceof Error ? err.message : "No se pudo matricular";
          }
        }
        await audit(db, request, {
          action: "promotion.committed",
          data: { to: next.name, students: rows.length, enrolled },
        });
      }
      return { dryRun: input.dryRun, enrolled, rows: rows.map(({ toSectionId: _, ...r }) => r) };
    },
  );
}
