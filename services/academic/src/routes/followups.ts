import { badRequest, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import { type FollowUpDto, followUpInputSchema } from "@escolar/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { type StudentFollowUp, studentFollowUps, students } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";

const idParams = z.object({ id: z.uuid() });

/**
 * Seguimiento de alumnos en riesgo: qué se hizo (llamada, reunión, referido a orientación…) y qué
 * se acordó. Lo registran la dirección y coordinación; secretaría lo consulta.
 */
export async function followUpRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const read = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };
  const write = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };

  const toDto = (request: FastifyRequest, f: StudentFollowUp): FollowUpDto => ({
    id: f.id,
    kind: f.kind,
    date: f.date,
    notes: f.notes,
    authorName: f.authorName,
    createdAt: f.createdAt.toISOString(),
    canDelete: request.auth.role === "admin" || f.authorUserId === request.auth.userId,
  });

  async function studentOrThrow(schoolId: string, id: string) {
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, id)));
    if (!student) throw notFound("Alumno no encontrado");
  }

  app.get("/students/:id/follow-ups", read, async (request): Promise<FollowUpDto[]> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await studentOrThrow(schoolId, id);
    const rows = await db
      .select()
      .from(studentFollowUps)
      .where(and(eq(studentFollowUps.schoolId, schoolId), eq(studentFollowUps.studentId, id)))
      .orderBy(desc(studentFollowUps.date), desc(studentFollowUps.createdAt));
    return rows.map((r) => toDto(request, r));
  });

  app.post("/students/:id/follow-ups", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(followUpInputSchema, request.body);
    if (input.date > today())
      throw badRequest("La fecha no puede ser futura", {
        fields: [{ path: "date", message: "No puede ser futura" }],
      });
    await studentOrThrow(schoolId, id);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(studentFollowUps)
        .values({
          schoolId,
          studentId: id,
          ...input,
          authorUserId: request.auth.userId,
          authorName: request.auth.name,
        })
        .returning();
      if (!row) throw new Error("No se registró el seguimiento");
      await audit(tx, request, {
        action: "student.follow_up_added",
        entityType: "student",
        entityId: id,
        data: { kind: input.kind },
      });
      return row;
    });
    return reply.status(201).send(toDto(request, created));
  });

  /** Borrar una anotación hecha por error: quien la escribió o la dirección. */
  app.delete("/follow-ups/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(studentFollowUps)
      .where(and(eq(studentFollowUps.schoolId, schoolId), eq(studentFollowUps.id, id)));
    if (!row) throw notFound("Seguimiento no encontrado");
    if (!toDto(request, row).canDelete)
      throw forbidden("Solo quien lo registró o la dirección lo puede borrar");
    await db.transaction(async (tx) => {
      await tx.delete(studentFollowUps).where(eq(studentFollowUps.id, id));
      await audit(tx, request, {
        action: "student.follow_up_deleted",
        entityType: "student",
        entityId: row.studentId,
        data: { kind: row.kind, date: row.date },
      });
    });
    return reply.status(204).send();
  });
}
