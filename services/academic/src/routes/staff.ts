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
  type CoverageDto,
  formatDay,
  isIsoDate,
  type LeaveDto,
  leaveInputSchema,
  substitutionInputSchema,
} from "@escolar/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { substitutions, teacherLeaves, teachingAssignments } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { bearerOf } from "../lib/identity-client";
import {
  coverageFor,
  getLeave,
  listLeaves,
  lockTeacher,
  overlappingLeave,
  requireTeacher,
} from "../lib/staff";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ estado: z.enum(["actuales", "pasadas", "canceladas"]).default("actuales") });
const dateQuery = z.object({ fecha: z.string().refine(isIsoDate).optional() });

/**
 * Licencias de maestros y sustituciones ("mover maestros"): la dirección registra la ausencia y
 * asigna quién cubre cada clase. Al terminar la licencia, las clases vuelven solas al titular
 * porque la sustitución tiene fecha de fin. Nada se borra: cancelar deja el historial.
 */
export async function staffRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const read = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };
  const write = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };

  app.get("/leaves", read, async (request): Promise<LeaveDto[]> => {
    const { estado } = parseOrThrow(listQuery, request.query);
    return listLeaves(db, tenantOf(request), estado, today());
  });

  app.get("/leaves/:id", read, async (request): Promise<LeaveDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return getLeave(db, tenantOf(request), id);
  });

  app.post("/leaves", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(leaveInputSchema, request.body);
    const teacher = await requireTeacher(identity, request, input.teacherUserId);
    const leaveId = await db.transaction(async (tx) => {
      await lockTeacher(tx, teacher.id);
      const clash = await overlappingLeave(tx, schoolId, teacher.id, input.startsOn, input.endsOn);
      if (clash) {
        throw conflict(
          `${teacher.name} ya tiene una licencia del ${formatDay(clash.startsOn)} al ${formatDay(clash.endsOn)}`,
        );
      }
      const [leave] = await tx
        .insert(teacherLeaves)
        .values({
          schoolId,
          teacherUserId: teacher.id,
          teacherName: teacher.name,
          type: input.type,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          notes: input.notes ?? null,
          createdByUserId: request.auth.userId,
          createdByName: request.auth.name,
        })
        .returning();
      if (!leave) throw new Error("No se registró la licencia");
      await audit(tx, request, {
        action: "leave.created",
        entityType: "leave",
        entityId: leave.id,
        data: { teacher: teacher.name, type: input.type, startsOn: input.startsOn, endsOn: input.endsOn },
      });
      return leave.id;
    });
    return reply.status(201).send(await getLeave(db, schoolId, leaveId));
  });

  app.post("/leaves/:id/cancel", write, async (request): Promise<LeaveDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const now = new Date();
      const [leave] = await tx
        .update(teacherLeaves)
        .set({ cancelledAt: now })
        .where(
          and(
            eq(teacherLeaves.schoolId, schoolId),
            eq(teacherLeaves.id, id),
            isNull(teacherLeaves.cancelledAt),
          ),
        )
        .returning();
      if (!leave) throw notFound("Licencia vigente no encontrada");
      await tx
        .update(substitutions)
        .set({ cancelledAt: now })
        .where(and(eq(substitutions.leaveId, id), isNull(substitutions.cancelledAt)));
      await audit(tx, request, { action: "leave.cancelled", entityType: "leave", entityId: id });
    });
    return getLeave(db, schoolId, id);
  });

  app.post("/leaves/:id/substitutions", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(substitutionInputSchema, request.body);
    const leave = await getLeave(db, schoolId, id);
    if (leave.cancelled) throw badRequest("La licencia está cancelada");

    const [assignment] = await db
      .select()
      .from(teachingAssignments)
      .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.id, input.assignmentId)));
    if (!assignment) throw notFound("Clase no encontrada");
    if (assignment.teacherUserId !== leave.teacherUserId) {
      throw badRequest(`Esa clase no es de ${leave.teacherName}`);
    }

    const startsOn = input.startsOn ?? leave.startsOn;
    const endsOn = input.endsOn ?? leave.endsOn;
    if (startsOn < leave.startsOn || endsOn > leave.endsOn || startsOn > endsOn) {
      throw badRequest(
        `La sustitución debe estar dentro de la licencia (${formatDay(leave.startsOn)} al ${formatDay(leave.endsOn)})`,
      );
    }
    if (input.substituteUserId === leave.teacherUserId) {
      throw badRequest("El sustituto no puede ser el mismo maestro que está de licencia");
    }
    const substitute = await requireTeacher(identity, request, input.substituteUserId);

    const subId = await db.transaction(async (tx) => {
      await lockTeacher(tx, substitute.id);
      const busy = await overlappingLeave(tx, schoolId, substitute.id, startsOn, endsOn);
      if (busy) {
        throw conflict(
          `${substitute.name} también tiene licencia del ${formatDay(busy.startsOn)} al ${formatDay(busy.endsOn)}`,
        );
      }
      try {
        const [sub] = await tx
          .insert(substitutions)
          .values({
            schoolId,
            leaveId: id,
            assignmentId: assignment.id,
            substituteUserId: substitute.id,
            substituteName: substitute.name,
            startsOn,
            endsOn,
            createdByUserId: request.auth.userId,
          })
          .returning();
        if (!sub) throw new Error("No se registró la sustitución");
        await audit(tx, request, {
          action: "substitution.created",
          entityType: "substitution",
          entityId: sub.id,
          data: { leaveId: id, assignmentId: assignment.id, substitute: substitute.name, startsOn, endsOn },
        });
        return sub.id;
      } catch (err) {
        if (isUniqueViolation(err, "substitutions_active_unique")) {
          throw conflict("Esa clase ya tiene sustituto en esta licencia. Quita el actual para cambiarlo.");
        }
        throw err;
      }
    });
    request.log.info({ substitutionId: subId }, "Sustitución registrada");
    return reply.status(201).send(await getLeave(db, schoolId, id));
  });

  app.post("/substitutions/:id/cancel", write, async (request): Promise<LeaveDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const leaveId = await db.transaction(async (tx) => {
      const [sub] = await tx
        .update(substitutions)
        .set({ cancelledAt: new Date() })
        .where(
          and(
            eq(substitutions.schoolId, schoolId),
            eq(substitutions.id, id),
            isNull(substitutions.cancelledAt),
          ),
        )
        .returning();
      if (!sub) throw notFound("Sustitución no encontrada");
      await audit(tx, request, {
        action: "substitution.cancelled",
        entityType: "substitution",
        entityId: id,
      });
      return sub.leaveId;
    });
    return getLeave(db, schoolId, leaveId);
  });

  app.get("/coverage", read, async (request): Promise<CoverageDto> => {
    const { fecha } = parseOrThrow(dateQuery, request.query);
    return coverageFor(db, tenantOf(request), fecha ?? today());
  });

  /**
   * Las clases, licencias y sustituciones guardan una copia del nombre del docente (para no llamar a
   * identity en cada pantalla). Cuando la dirección corrige un nombre, se actualizan esas copias; el
   * historial (quién aprobó, quién registró) queda como se escribió.
   */
  app.post(
    "/people/:id/refresh-name",
    { preHandler: [app.authenticate, requireRole("admin")] },
    async (request) => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      const person = await identity.getUser(bearerOf(request), id);
      if (!person) throw notFound("Persona no encontrada");
      await db.transaction(async (tx) => {
        await tx
          .update(teachingAssignments)
          .set({ teacherName: person.name })
          .where(and(eq(teachingAssignments.schoolId, schoolId), eq(teachingAssignments.teacherUserId, id)));
        await tx
          .update(teacherLeaves)
          .set({ teacherName: person.name })
          .where(and(eq(teacherLeaves.schoolId, schoolId), eq(teacherLeaves.teacherUserId, id)));
        await tx
          .update(substitutions)
          .set({ substituteName: person.name })
          .where(and(eq(substitutions.schoolId, schoolId), eq(substitutions.substituteUserId, id)));
      });
      return { name: person.name };
    },
  );
}
