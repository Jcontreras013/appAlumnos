import {
  badRequest,
  conflict,
  isUniqueViolation,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import { receiveTransferSchema, type TransferDto, transferInputSchema } from "@escolar/shared";
import { and, desc, eq, gte, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  enrollments,
  type StudentTransfer,
  studentGuardians,
  students,
  studentTransfers,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { enrollStudent } from "../lib/enroll";
import { bearerOf } from "../lib/identity-client";
import { findCurrentYear } from "../lib/queries";
import { findOrCreateGuardian, insertStudent } from "../lib/students";
import { transferSnapshot } from "../lib/transfers";

const idParams = z.object({ id: z.uuid() });

const toDto = (t: StudentTransfer, side: "from" | "to"): TransferDto => ({
  id: t.id,
  direction: side === "from" ? "salida" : "entrada",
  status: t.status,
  fromSchoolName: t.fromSchoolName,
  toSchoolName: t.toSchoolName,
  studentName: `${t.snapshot.student.firstNames} ${t.snapshot.student.lastNames}`,
  date: t.date,
  notes: t.notes,
  createdByName: t.createdByName,
  createdAt: t.createdAt.toISOString(),
  receivedAt: t.receivedAt?.toISOString() ?? null,
  studentId: side === "from" ? t.fromStudentId : t.toStudentId,
  snapshot: t.snapshot,
});

/**
 * Traslados entre centros del mismo departamento. El de origen registra el traslado (se retira la
 * matrícula y se envía una copia del alumno); el de destino lo recibe y elige la sección.
 */
export async function transferRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const office = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };

  app.post("/students/:id/transfers", office, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(transferInputSchema, request.body);
    if (input.date > today()) throw badRequest("La fecha del traslado no puede ser futura");
    const token = bearerOf(request);
    const [targets, scope] = await Promise.all([
      identity.getTransferTargets(token),
      identity.getScopeSchools(token),
    ]);
    const target = targets.find((t) => t.id === input.toSchoolId);
    if (!target) throw badRequest("Ese centro no está en tu departamento o no está activo");
    const own = scope.find((s) => s.id === schoolId);
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, id)));
    if (!student) throw notFound("Alumno no encontrado");
    const snapshot = await transferSnapshot(db, schoolId, id);
    try {
      const created = await db.transaction(async (tx) => {
        const year = await findCurrentYear(tx, schoolId);
        if (year) {
          await tx
            .update(enrollments)
            .set({ status: "retirada", withdrawnOn: input.date, withdrawReason: `Traslado a ${target.name}` })
            .where(
              and(
                eq(enrollments.schoolId, schoolId),
                eq(enrollments.studentId, id),
                eq(enrollments.schoolYearId, year.id),
                eq(enrollments.status, "activa"),
              ),
            );
        }
        const [row] = await tx
          .insert(studentTransfers)
          .values({
            fromSchoolId: schoolId,
            fromSchoolName: own?.name ?? "Centro de origen",
            fromStudentId: id,
            toSchoolId: target.id,
            toSchoolName: target.name,
            date: input.date,
            notes: input.notes ?? null,
            snapshot,
            createdByUserId: request.auth.userId,
            createdByName: request.auth.name,
          })
          .returning();
        if (!row) throw new Error("No se registró el traslado");
        await audit(tx, request, {
          action: "student.transfer_sent",
          entityType: "student",
          entityId: id,
          data: { to: target.name },
        });
        return row;
      });
      return reply.status(201).send(toDto(created, "from"));
    } catch (err) {
      if (isUniqueViolation(err, "student_transfers_one_pending")) {
        throw conflict("Este alumno ya tiene un traslado pendiente");
      }
      throw err;
    }
  });

  /** Los que llegan (pendientes y del último mes) y los que se enviaron. */
  app.get(
    "/transfers",
    office,
    async (request): Promise<{ incoming: TransferDto[]; outgoing: TransferDto[] }> => {
      const schoolId = tenantOf(request);
      const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
      const [incoming, outgoing] = await Promise.all([
        db
          .select()
          .from(studentTransfers)
          .where(
            and(
              eq(studentTransfers.toSchoolId, schoolId),
              or(eq(studentTransfers.status, "pendiente"), gte(studentTransfers.createdAt, since)),
            ),
          )
          .orderBy(desc(studentTransfers.createdAt)),
        db
          .select()
          .from(studentTransfers)
          .where(and(eq(studentTransfers.fromSchoolId, schoolId), gte(studentTransfers.createdAt, since)))
          .orderBy(desc(studentTransfers.createdAt)),
      ]);
      return {
        incoming: incoming.map((t) => toDto(t, "to")),
        outgoing: outgoing.map((t) => toDto(t, "from")),
      };
    },
  );

  /** Recibir: el alumno queda en este centro (nuevo o el que ya tenía), con sus responsables y matriculado. */
  app.post("/transfers/:id/receive", office, async (request): Promise<TransferDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { sectionId } = parseOrThrow(receiveTransferSchema, request.body);
    const received = await db.transaction(async (tx) => {
      const [transfer] = await tx
        .select()
        .from(studentTransfers)
        .where(and(eq(studentTransfers.id, id), eq(studentTransfers.toSchoolId, schoolId)))
        .for("update");
      if (!transfer) throw notFound("Traslado no encontrado");
      if (transfer.status !== "pendiente") throw conflict("Este traslado ya no está pendiente");
      const s = transfer.snapshot.student;
      const [existing] = s.nationalId
        ? await tx
            .select()
            .from(students)
            .where(and(eq(students.schoolId, schoolId), eq(students.nationalId, s.nationalId)))
        : [];
      const student =
        existing ??
        (await insertStudent(tx, schoolId, {
          firstNames: s.firstNames,
          lastNames: s.lastNames,
          nationalId: s.nationalId ?? undefined,
          birthDate: s.birthDate ?? undefined,
          sex: s.sex ?? undefined,
          medicalNotes: s.medicalNotes ?? undefined,
          notes: `Trasladado de ${transfer.fromSchoolName}.`,
        }));
      const linked = await tx
        .select()
        .from(studentGuardians)
        .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, student.id)));
      for (const g of transfer.snapshot.guardians) {
        const { guardian } = await findOrCreateGuardian(tx, schoolId, {
          fullName: g.fullName,
          nationalId: g.nationalId ?? undefined,
          phone: g.phone ?? undefined,
          email: g.email ?? undefined,
        });
        if (linked.some((l) => l.guardianId === guardian.id)) continue;
        await tx.insert(studentGuardians).values({
          schoolId,
          studentId: student.id,
          guardianId: guardian.id,
          relationship: g.relationship,
          // El principal viene del centro de origen, salvo que el alumno ya tuviera uno aquí.
          isPrimary: g.isPrimary && !linked.some((l) => l.isPrimary),
        });
      }
      await enrollStudent(tx, { schoolId, studentId: student.id, sectionId, today: today() });
      const [row] = await tx
        .update(studentTransfers)
        .set({ status: "recibido", toStudentId: student.id, receivedAt: new Date() })
        .where(eq(studentTransfers.id, id))
        .returning();
      await audit(tx, request, {
        action: "student.transfer_received",
        entityType: "student",
        entityId: student.id,
        data: { from: transfer.fromSchoolName },
      });
      return row ?? transfer;
    });
    return toDto(received, "to");
  });

  /** El centro de origen anula un traslado que todavía no recibieron (la matrícula se rehace a mano). */
  app.post("/transfers/:id/cancel", office, async (request): Promise<TransferDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .update(studentTransfers)
      .set({ status: "cancelado" })
      .where(
        and(
          eq(studentTransfers.id, id),
          eq(studentTransfers.fromSchoolId, schoolId),
          eq(studentTransfers.status, "pendiente"),
        ),
      )
      .returning();
    if (!row) throw notFound("Traslado pendiente no encontrado");
    await audit(db, request, {
      action: "student.transfer_cancelled",
      entityType: "student",
      entityId: row.fromStudentId,
      data: { to: row.toSchoolName },
    });
    return toDto(row, "from");
  });

  /** Traslados de un alumno de este centro: de dónde vino (con su historial) o a dónde se fue. */
  app.get("/students/:id/transfers", office, async (request): Promise<TransferDto[]> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const rows = await db
      .select()
      .from(studentTransfers)
      .where(
        or(
          and(eq(studentTransfers.fromSchoolId, schoolId), eq(studentTransfers.fromStudentId, id)),
          and(eq(studentTransfers.toSchoolId, schoolId), eq(studentTransfers.toStudentId, id)),
        ),
      )
      .orderBy(desc(studentTransfers.createdAt));
    return rows.map((t) => toDto(t, t.fromSchoolId === schoolId ? "from" : "to"));
  });
}
