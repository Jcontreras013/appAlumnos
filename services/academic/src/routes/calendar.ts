import { badRequest, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import { dayOffInputSchema, dayOffOn, formatDay, type SchoolCalendarDto } from "@escolar/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { schoolDaysOff, schoolYears } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { toDayOffDto } from "../lib/calendar";
import { findCurrentYear } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const yearQuery = z.object({ schoolYearId: z.uuid().optional() });

/** Quién marca el calendario escolar: la secretaría y la dirección. */
const EDITORS = ["admin", "secretaria"] as const;

/**
 * Calendario escolar: feriados, vacaciones y días sin clases del centro. Todo el personal lo ve;
 * la secretaría y la dirección lo marcan.
 */
export async function calendarRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const read = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const write = { preHandler: [app.authenticate, requireRole(...EDITORS)] };

  app.get("/calendar", read, async (request): Promise<SchoolCalendarDto> => {
    const schoolId = tenantOf(request);
    const { schoolYearId } = parseOrThrow(yearQuery, request.query);
    const year = schoolYearId
      ? ((
          await db
            .select()
            .from(schoolYears)
            .where(and(eq(schoolYears.schoolId, schoolId), eq(schoolYears.id, schoolYearId)))
        )[0] ?? null)
      : await findCurrentYear(db, schoolId);
    const rows = year
      ? await db
          .select()
          .from(schoolDaysOff)
          .where(and(eq(schoolDaysOff.schoolId, schoolId), eq(schoolDaysOff.schoolYearId, year.id)))
          .orderBy(asc(schoolDaysOff.startsOn))
      : [];
    const daysOff = rows.map(toDayOffDto);
    return {
      schoolYear: year
        ? { id: year.id, name: year.name, startsOn: year.startsOn, endsOn: year.endsOn }
        : null,
      daysOff,
      today: dayOffOn(today(), daysOff),
      canEdit: (EDITORS as readonly string[]).includes(request.auth.role),
    };
  });

  app.post("/calendar/days-off", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(dayOffInputSchema, request.body);
    // El período va en el año lectivo que lo contiene (el vigente o el que se está preparando).
    const years = await db.select().from(schoolYears).where(eq(schoolYears.schoolId, schoolId));
    const year = years.find((y) => y.startsOn <= input.startsOn && input.endsOn <= y.endsOn);
    if (!year) {
      throw badRequest(
        years.length
          ? `Las fechas tienen que estar dentro de un año lectivo (${years
              .map((y) => `${y.name}: ${formatDay(y.startsOn)} a ${formatDay(y.endsOn)}`)
              .join("; ")}).`
          : "Primero configura el año lectivo en Estructura académica.",
        { fields: [{ path: "startsOn", message: "Fuera del año lectivo" }] },
      );
    }
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schoolDaysOff)
        .values({
          schoolId,
          schoolYearId: year.id,
          ...input,
          createdByUserId: request.auth.userId,
          createdByName: request.auth.name,
        })
        .returning();
      if (!row) throw new Error("No se guardó el día sin clases");
      await audit(tx, request, {
        action: "calendar.day_off_added",
        entityType: "school_day_off",
        entityId: row.id,
        data: { name: row.name, kind: row.kind, startsOn: row.startsOn, endsOn: row.endsOn },
      });
      return row;
    });
    return reply.status(201).send(toDayOffDto(created));
  });

  app.delete("/calendar/days-off/:id", write, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(schoolDaysOff)
        .where(and(eq(schoolDaysOff.schoolId, schoolId), eq(schoolDaysOff.id, id)))
        .returning();
      if (!row) throw notFound("Ese día sin clases ya no existe");
      await audit(tx, request, {
        action: "calendar.day_off_removed",
        entityType: "school_day_off",
        entityId: row.id,
        data: { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn },
      });
    });
    return reply.status(204).send();
  });
}
