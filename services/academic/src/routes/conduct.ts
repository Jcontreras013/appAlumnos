import { badRequest, forbidden, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  addDays,
  CONDUCT_MEASURE_LABELS,
  type ConductActaDto,
  type ConductIncidentDto,
  type ConductOverviewDto,
  type ConductStudentOptionDto,
  DIRECTOR_ONLY_MEASURES,
  incidentInputSchema,
  measureInputSchema,
} from "@escolar/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  conductIncidents,
  conductMeasures,
  enrollments,
  guardians,
  studentGuardians,
  students,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { conductTotals, listIncidents, yearRange } from "../lib/conduct";
import { rosterOf, teacherClasses } from "../lib/evaluation";
import { findCurrentYear, listSections } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });

/**
 * Conducta: el personal reporta incidentes y el centro decide medidas. El maestro reporta a alumnos
 * de las secciones donde da clases (o cubre) y ve sus propios reportes; la coordinación registra
 * llamados de atención, citaciones y compromisos; la suspensión y la expulsión las decide solo la
 * dirección. La expulsión retira la matrícula en la misma transacción. Todo queda en la bitácora.
 */
export async function conductRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const office = ["admin", "coordinador", "secretaria"] as const;
  const read = { preHandler: [app.authenticate, requireRole(...office, "docente")] };
  const reporters = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "docente")] };
  const deciders = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };
  const officeOnly = { preHandler: [app.authenticate, requireRole(...office)] };
  const directorOnly = { preHandler: [app.authenticate, requireRole("admin")] };

  const isOffice = (request: FastifyRequest) => (office as readonly string[]).includes(request.auth.role);
  const canDeleteFor = (request: FastifyRequest) => (i: { reportedByUserId: string }) =>
    request.auth.role === "admin" || i.reportedByUserId === request.auth.userId;

  /** Alumnos a los que quien pregunta puede reportar: la oficina, todos; el maestro, los de sus secciones. */
  async function reportableStudents(request: FastifyRequest): Promise<ConductStudentOptionDto[]> {
    const schoolId = tenantOf(request);
    const year = await findCurrentYear(db, schoolId);
    if (!year) return [];
    const sections = await listSections(db, schoolId, year.id);
    let sectionIds = sections.map((s) => s.id);
    if (request.auth.role === "docente") {
      const classes = await teacherClasses(db, schoolId, request.auth.userId, today());
      const mine = new Set(classes.map((c) => c.assignment.sectionId));
      sectionIds = sectionIds.filter((id) => mine.has(id));
    }
    const labels = new Map(sections.map((s) => [s.id, s.label]));
    return (await rosterOf(db, schoolId, sectionIds)).map((r) => ({
      studentId: r.studentId,
      name: `${r.lastNames}, ${r.firstNames}`,
      sectionId: r.sectionId,
      sectionLabel: labels.get(r.sectionId) ?? "",
    }));
  }

  async function incidentOrThrow(schoolId: string, id: string) {
    const [incident] = await db
      .select()
      .from(conductIncidents)
      .where(and(eq(conductIncidents.schoolId, schoolId), eq(conductIncidents.id, id)));
    if (!incident) throw notFound("Incidente no encontrado");
    return incident;
  }

  async function incidentDto(request: FastifyRequest, id: string): Promise<ConductIncidentDto> {
    const schoolId = tenantOf(request);
    const incident = await incidentOrThrow(schoolId, id);
    const [dto] = await listIncidents(
      db,
      schoolId,
      { studentId: incident.studentId, from: incident.date, to: incident.date },
      canDeleteFor(request),
    ).then((list) => list.filter((i) => i.id === id));
    if (!dto) throw notFound("Incidente no encontrado");
    return dto;
  }

  /** La pantalla de Conducta: incidentes del año (el maestro, solo los que reportó) y totales. */
  app.get("/conduct", read, async (request): Promise<ConductOverviewDto> => {
    const schoolId = tenantOf(request);
    const incidents = await listIncidents(
      db,
      schoolId,
      {
        ...(await yearRange(db, schoolId)),
        ...(isOffice(request) ? {} : { reportedBy: request.auth.userId }),
      },
      canDeleteFor(request),
    );
    const role = request.auth.role;
    return {
      incidents,
      totals: conductTotals(incidents, today(), addDays(today(), -29)),
      can: {
        report: role === "admin" || role === "coordinador" || role === "docente",
        measure: role === "admin" || role === "coordinador",
        suspendOrExpel: role === "admin",
      },
    };
  });

  app.get(
    "/conduct/students",
    read,
    async (request): Promise<ConductStudentOptionDto[]> => reportableStudents(request),
  );

  /** Historial de conducta de un alumno (todos los años), para su ficha. */
  app.get("/students/:id/conduct", officeOnly, async (request): Promise<ConductIncidentDto[]> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, id)));
    if (!student) throw notFound("Alumno no encontrado");
    return listIncidents(db, schoolId, { studentId: id }, canDeleteFor(request));
  });

  app.post("/conduct/incidents", reporters, async (request, reply): Promise<ConductIncidentDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(incidentInputSchema, request.body);
    if (input.date > today()) {
      throw badRequest("La fecha no puede ser futura", {
        fields: [{ path: "date", message: "No puede ser futura" }],
      });
    }
    // El maestro solo reporta a alumnos de sus secciones; un alumno ajeno se responde como inexistente.
    const allowed = await reportableStudents(request);
    if (!allowed.some((s) => s.studentId === input.studentId)) throw notFound("Alumno no encontrado");
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(conductIncidents)
        .values({
          schoolId,
          ...input,
          reportedByUserId: request.auth.userId,
          reportedByName: request.auth.name,
        })
        .returning();
      if (!row) throw new Error("No se registró el incidente");
      await audit(tx, request, {
        action: "conduct.incident_reported",
        entityType: "student",
        entityId: input.studentId,
        data: { severity: input.severity, category: input.category },
      });
      return row;
    });
    return reply.status(201).send(await incidentDto(request, created.id));
  });

  /** Borrar un reporte hecho por error: quien lo hizo o la dirección, mientras no tenga medidas. */
  app.delete("/conduct/incidents/:id", reporters, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const incident = await incidentOrThrow(schoolId, id);
    if (!canDeleteFor(request)(incident))
      throw forbidden("Solo quien lo reportó o la dirección lo puede borrar");
    await db.transaction(async (tx) => {
      const [measure] = await tx
        .select({ id: conductMeasures.id })
        .from(conductMeasures)
        .where(and(eq(conductMeasures.schoolId, schoolId), eq(conductMeasures.incidentId, id)))
        .limit(1);
      if (measure) throw badRequest("Tiene medidas registradas: queda en el historial y no se puede borrar");
      await tx.delete(conductIncidents).where(eq(conductIncidents.id, id));
      await audit(tx, request, {
        action: "conduct.incident_deleted",
        entityType: "student",
        entityId: incident.studentId,
      });
    });
    return reply.status(204).send();
  });

  app.post(
    "/conduct/incidents/:id/measures",
    deciders,
    async (request, reply): Promise<ConductIncidentDto> => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      const input = parseOrThrow(measureInputSchema, request.body);
      if (DIRECTOR_ONLY_MEASURES.includes(input.kind) && request.auth.role !== "admin") {
        throw forbidden(`La ${CONDUCT_MEASURE_LABELS[input.kind].toLowerCase()} la decide solo la dirección`);
      }
      if (input.kind === "expulsion" && input.startsOn > today()) {
        throw badRequest("La expulsión se registra el día en que se decide (no puede ser futura)", {
          fields: [{ path: "startsOn", message: "No puede ser futura" }],
        });
      }
      const incident = await incidentOrThrow(schoolId, id);
      if (input.startsOn < incident.date) {
        throw badRequest("La medida no puede ser anterior al incidente", {
          fields: [{ path: "startsOn", message: "Es anterior al incidente" }],
        });
      }
      await db.transaction(async (tx) => {
        await tx.insert(conductMeasures).values({
          schoolId,
          incidentId: id,
          kind: input.kind,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          notes: input.notes,
          notifyFamily: input.notifyFamily,
          decidedByUserId: request.auth.userId,
          decidedByName: request.auth.name,
        });
        await audit(tx, request, {
          action: "conduct.measure_added",
          entityType: "student",
          entityId: incident.studentId,
          data: {
            kind: input.kind,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            notifyFamily: input.notifyFamily,
          },
        });
        if (input.kind === "expulsion") {
          // La expulsión retira la matrícula del año vigente; si no hay, no se registra nada.
          const year = await findCurrentYear(tx, schoolId);
          const reason = `Expulsión: ${input.notes}`.slice(0, 500);
          const [enrollment] = year
            ? await tx
                .update(enrollments)
                .set({ status: "retirada", withdrawnOn: input.startsOn, withdrawReason: reason })
                .where(
                  and(
                    eq(enrollments.schoolId, schoolId),
                    eq(enrollments.studentId, incident.studentId),
                    eq(enrollments.schoolYearId, year.id),
                    eq(enrollments.status, "activa"),
                  ),
                )
                .returning()
            : [];
          if (!enrollment) throw badRequest("El alumno no tiene matrícula activa en el año vigente");
          await audit(tx, request, {
            action: "enrollment.withdrawn",
            entityType: "enrollment",
            entityId: enrollment.id,
            data: { reason, withdrawnOn: input.startsOn },
          });
        }
      });
      return reply.status(201).send(await incidentDto(request, id));
    },
  );

  /**
   * Datos del acta impresa de una medida, para que el alumno y su familia la firmen. La imprime la
   * oficina; el maestro, solo las de incidentes que él reportó.
   */
  app.get("/conduct/measures/:id/acta", read, async (request): Promise<ConductActaDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(conductMeasures)
      .where(and(eq(conductMeasures.schoolId, schoolId), eq(conductMeasures.id, id)));
    if (!row) throw notFound("Medida no encontrada");
    const incident = await incidentOrThrow(schoolId, row.incidentId);
    if (!isOffice(request) && incident.reportedByUserId !== request.auth.userId) {
      throw notFound("Medida no encontrada");
    }
    const [dto, [student], family] = await Promise.all([
      incidentDto(request, incident.id),
      db
        .select({ nationalId: students.nationalId })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.id, incident.studentId))),
      db
        .select({ fullName: guardians.fullName, isPrimary: studentGuardians.isPrimary })
        .from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
        .where(
          and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, incident.studentId)),
        ),
    ]);
    const measure = dto.measures.find((m) => m.id === id);
    if (!measure) throw notFound("Medida no encontrada");
    const primary = family.find((g) => g.isPrimary) ?? family[0];
    return {
      incident: dto,
      measure,
      nationalId: student?.nationalId ?? null,
      guardianName: primary?.fullName ?? null,
    };
  });

  /**
   * Anular una medida registrada por error (solo la dirección). Queda en el historial como anulada.
   * Anular una expulsión no vuelve a matricular: eso se hace desde la ficha del alumno.
   */
  app.post("/conduct/measures/:id/cancel", directorOnly, async (request): Promise<ConductIncidentDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const incidentId = await db.transaction(async (tx) => {
      const [measure] = await tx
        .update(conductMeasures)
        .set({ cancelledAt: new Date(), cancelledByUserId: request.auth.userId })
        .where(
          and(
            eq(conductMeasures.schoolId, schoolId),
            eq(conductMeasures.id, id),
            isNull(conductMeasures.cancelledAt),
          ),
        )
        .returning();
      if (!measure) throw notFound("Medida no encontrada o ya anulada");
      await audit(tx, request, {
        action: "conduct.measure_cancelled",
        entityType: "conduct_measure",
        entityId: id,
        data: { kind: measure.kind },
      });
      return measure.incidentId;
    });
    return incidentDto(request, incidentId);
  });
}
