import {
  conflict,
  isUniqueViolation,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import { describeClassDays, type ShiftDto, shiftInputSchema } from "@escolar/shared";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { scheduleSlots, sections, shifts } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { bearerOf } from "../lib/identity-client";
import { findCurrentYear } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });

/**
 * Jornadas del centro: matutina, vespertina, nocturna, fin de semana, dominical… Cada una con sus días
 * de clase (y, en el horario, sus horas). La dirección las define; cada sección pertenece a una. Un
 * centro sin jornadas trabaja de lunes a viernes, como siempre.
 */
export async function shiftRoutes(app: FastifyInstance, { db, identity }: AcademicDeps) {
  const read = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const director = { preHandler: [app.authenticate, requireRole("admin")] };

  async function list(schoolId: string): Promise<ShiftDto[]> {
    const year = await findCurrentYear(db, schoolId);
    const counts = year
      ? await db
          .select({ shiftId: sections.shiftId, n: sql<number>`count(*)::int` })
          .from(sections)
          .where(and(eq(sections.schoolId, schoolId), eq(sections.schoolYearId, year.id)))
          .groupBy(sections.shiftId)
      : [];
    const rows = await db
      .select()
      .from(shifts)
      .where(eq(shifts.schoolId, schoolId))
      .orderBy(asc(shifts.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      classDays: r.classDays,
      sections: counts.find((c) => c.shiftId === r.id)?.n ?? 0,
    }));
  }

  async function get(schoolId: string, id: string) {
    const [row] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.schoolId, schoolId), eq(shifts.id, id)));
    if (!row) throw notFound("Jornada no encontrada");
    return row;
  }

  /**
   * Si alguna jornada tiene clases sábado o domingo, los avisos en el celular también llegan esos días
   * (los guarda identity). Si identity no responde, las jornadas igual quedan: se reintenta al guardar.
   */
  async function syncWeekendNotices(request: FastifyRequest) {
    const [row] = await db
      .select({ weekend: sql<boolean>`bool_or(${shifts.classDays} && array[6, 7])` })
      .from(shifts)
      .where(eq(shifts.schoolId, tenantOf(request)));
    try {
      await identity.setWeekendNotices(bearerOf(request), row?.weekend ?? false);
    } catch (err) {
      request.log.warn({ err }, "No se pudo actualizar el aviso de fin de semana en identity");
    }
  }

  const named = async <T>(promise: Promise<T>, name: string): Promise<T> => {
    try {
      return await promise;
    } catch (err) {
      if (isUniqueViolation(err, "shifts_name_unique")) throw conflict(`Ya existe la jornada «${name}»`);
      throw err;
    }
  };

  app.get("/shifts", read, async (request): Promise<ShiftDto[]> => list(tenantOf(request)));

  app.post("/shifts", director, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(shiftInputSchema, request.body);
    const row = await named(
      db.transaction(async (tx) => {
        const [created] = await tx
          .insert(shifts)
          .values({ schoolId, name: input.name, classDays: input.classDays })
          .returning();
        if (!created) throw new Error("No se creó la jornada");
        await audit(tx, request, {
          action: "shift.created",
          entityType: "shift",
          entityId: created.id,
          data: { name: input.name, days: describeClassDays(input.classDays) },
        });
        return created;
      }),
      input.name,
    );
    await syncWeekendNotices(request);
    return reply.status(201).send((await list(schoolId)).find((s) => s.id === row.id));
  });

  /** Cambiar el nombre o los días. Las clases del horario en días que ya no son de clase se quitan. */
  app.put("/shifts/:id", director, async (request): Promise<ShiftDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(shiftInputSchema, request.body);
    const before = await get(schoolId, id);
    await named(
      db.transaction(async (tx) => {
        await tx
          .update(shifts)
          .set({ name: input.name, classDays: input.classDays })
          .where(eq(shifts.id, id));
        const own = tx
          .select({ id: sections.id })
          .from(sections)
          .where(and(eq(sections.schoolId, schoolId), eq(sections.shiftId, id)));
        await tx
          .delete(scheduleSlots)
          .where(
            and(
              eq(scheduleSlots.schoolId, schoolId),
              inArray(scheduleSlots.sectionId, own),
              notInArray(scheduleSlots.weekday, input.classDays),
            ),
          );
        await audit(tx, request, {
          action: "shift.updated",
          entityType: "shift",
          entityId: id,
          data: {
            before: { name: before.name, days: describeClassDays(before.classDays) },
            after: { name: input.name, days: describeClassDays(input.classDays) },
          },
        });
      }),
      input.name,
    );
    await syncWeekendNotices(request);
    const updated = (await list(schoolId)).find((s) => s.id === id);
    if (!updated) throw notFound("Jornada no encontrada");
    return updated;
  });

  /** Solo se borra si ninguna sección (de ningún año) está en ella. */
  app.delete("/shifts/:id", director, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const row = await get(schoolId, id);
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sections)
      .where(and(eq(sections.schoolId, schoolId), eq(sections.shiftId, id)));
    if (used && used.n > 0) {
      throw conflict(
        `La jornada «${row.name}» tiene ${used.n === 1 ? "una sección" : `${used.n} secciones`}: pásalas a otra jornada antes de borrarla.`,
      );
    }
    await db.transaction(async (tx) => {
      await tx.delete(shifts).where(eq(shifts.id, id));
      await audit(tx, request, {
        action: "shift.deleted",
        entityType: "shift",
        entityId: id,
        data: { name: row.name },
      });
    });
    await syncWeekendNotices(request);
    return reply.status(204).send();
  });
}
