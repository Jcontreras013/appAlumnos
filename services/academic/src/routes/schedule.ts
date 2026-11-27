import { badRequest, conflict, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type AssignmentDto,
  DEFAULT_CLASS_DAYS,
  type ScheduleBlockDto,
  type ScheduleDto,
  type ScheduleSlotDto,
  type SectionDto,
  scheduleBlocksInputSchema,
  sectionScheduleInputSchema,
  WEEKDAY_LABELS,
  weekdayOf,
} from "@escolar/shared";
import { and, asc, eq, gt, inArray, isNull, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { enrollments, scheduleBlocks, scheduleSlots, sections, shifts } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { childrenOf, studentOf } from "../lib/family";
import { findCurrentYear, getSection, listAssignments, listSections } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const blocksQuery = z.object({ shiftId: z.uuid().optional() });
const dayName = (weekday: number) => WEEKDAY_LABELS[weekdayOf(weekday)];
/** Las horas de una jornada (null = las de las secciones sin jornada). */
const ofShift = (shiftId: string | null): SQL =>
  shiftId ? eq(scheduleBlocks.shiftId, shiftId) : isNull(scheduleBlocks.shiftId);

async function blocksOf(db: DbOrTx, schoolId: string, shiftId: string | null): Promise<ScheduleBlockDto[]> {
  return db
    .select({
      number: scheduleBlocks.number,
      startsAt: scheduleBlocks.startsAt,
      endsAt: scheduleBlocks.endsAt,
    })
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.schoolId, schoolId), ofShift(shiftId)))
    .orderBy(asc(scheduleBlocks.number));
}

/** Todas las horas del centro, por jornada (clave "" = sin jornada). */
async function allBlocks(db: DbOrTx, schoolId: string) {
  const rows = await db
    .select()
    .from(scheduleBlocks)
    .where(eq(scheduleBlocks.schoolId, schoolId))
    .orderBy(asc(scheduleBlocks.number));
  const byShift = new Map<string, ScheduleBlockDto[]>();
  for (const r of rows) {
    const key = r.shiftId ?? "";
    const list = byShift.get(key) ?? [];
    list.push({ number: r.number, startsAt: r.startsAt, endsAt: r.endsAt });
    byShift.set(key, list);
  }
  return byShift;
}

/** El horario de una sección o de un grupo de secciones de la misma jornada. */
const scheduleOf = (
  blocks: ScheduleBlockDto[],
  slots: ScheduleSlotDto[],
  classDays: readonly number[],
): ScheduleDto => ({ blocks, slots, classDays: [...classDays] });

/** Casillas del horario con su clase (materia, docente, sección), del año vigente. */
async function slotsOf(
  db: DbOrTx,
  schoolId: string,
  keep: (slot: ScheduleSlotDto, assignment: AssignmentDto) => boolean,
): Promise<ScheduleSlotDto[]> {
  const year = await findCurrentYear(db, schoolId);
  if (!year) return [];
  const assignments = new Map(
    (await listAssignments(db, schoolId, { schoolYearId: year.id })).map((a) => [a.id, a]),
  );
  if (assignments.size === 0) return [];
  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(
      and(eq(scheduleSlots.schoolId, schoolId), inArray(scheduleSlots.assignmentId, [...assignments.keys()])),
    )
    .orderBy(asc(scheduleSlots.weekday), asc(scheduleSlots.block));
  return rows.flatMap((r) => {
    const a = assignments.get(r.assignmentId);
    if (!a) return [];
    const slot: ScheduleSlotDto = {
      weekday: r.weekday,
      block: r.block,
      assignmentId: a.id,
      subjectName: a.subjectName,
      teacherName: a.teacherName,
      sectionId: a.sectionId,
      sectionLabel: a.sectionLabel,
    };
    return keep(slot, a) ? [slot] : [];
  });
}

/**
 * Horario de clases: las horas (bloques) del centro y qué clase va en cada día y hora de cada
 * sección. Un docente no puede quedar en dos secciones a la misma hora.
 */
export async function scheduleRoutes(app: FastifyInstance, { db }: AcademicDeps) {
  const read = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };
  const write = { preHandler: [app.authenticate, requireRole("admin", "coordinador")] };

  app.get("/schedule/blocks", read, async (request): Promise<ScheduleBlockDto[]> => {
    const { shiftId } = parseOrThrow(blocksQuery, request.query);
    return blocksOf(db, tenantOf(request), shiftId ?? null);
  });

  /** Las horas de una jornada (o de las secciones sin jornada): la nocturna no empieza a las 7. */
  app.put("/schedule/blocks", write, async (request): Promise<ScheduleBlockDto[]> => {
    const schoolId = tenantOf(request);
    const { blocks, shiftId: rawShift } = parseOrThrow(scheduleBlocksInputSchema, request.body);
    const shiftId = rawShift ?? null;
    if (shiftId) {
      const [shift] = await db
        .select({ id: shifts.id })
        .from(shifts)
        .where(and(eq(shifts.schoolId, schoolId), eq(shifts.id, shiftId)));
      if (!shift) throw notFound("Jornada no encontrada");
    }
    await db.transaction(async (tx) => {
      await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.schoolId, schoolId), ofShift(shiftId)));
      if (blocks.length) {
        await tx
          .insert(scheduleBlocks)
          .values(blocks.map((b, i) => ({ schoolId, shiftId, number: i + 1, ...b })));
      }
      // Las clases de esa jornada puestas en horas que ya no existen se quitan del horario.
      const own = tx
        .select({ id: sections.id })
        .from(sections)
        .where(
          and(
            eq(sections.schoolId, schoolId),
            shiftId ? eq(sections.shiftId, shiftId) : isNull(sections.shiftId),
          ),
        );
      await tx
        .delete(scheduleSlots)
        .where(
          and(
            eq(scheduleSlots.schoolId, schoolId),
            inArray(scheduleSlots.sectionId, own),
            gt(scheduleSlots.block, blocks.length),
          ),
        );
      await audit(tx, request, {
        action: "schedule.blocks_updated",
        data: { blocks: blocks.length, shiftId },
      });
    });
    return blocksOf(db, schoolId, shiftId);
  });

  app.get("/schedule/sections/:id", read, async (request): Promise<ScheduleDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const section = await getSection(db, schoolId, id);
    return scheduleOf(
      await blocksOf(db, schoolId, section.shiftId),
      await slotsOf(db, schoolId, (s) => s.sectionId === id),
      section.classDays,
    );
  });

  app.put("/schedule/sections/:id", write, async (request): Promise<ScheduleDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { slots } = parseOrThrow(sectionScheduleInputSchema, request.body);
    const section = await getSection(db, schoolId, id);
    const blocksByShift = await allBlocks(db, schoolId);
    const blocks = blocksByShift.get(section.shiftId ?? "") ?? [];
    const own = new Map(
      (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId }))
        .filter((a) => a.sectionId === id)
        .map((a) => [a.id, a]),
    );
    const seen = new Set<string>();
    for (const s of slots) {
      const key = `${s.weekday}:${s.block}`;
      if (seen.has(key)) throw badRequest(`${dayName(s.weekday)}, ${s.block}.ª hora aparece dos veces`);
      seen.add(key);
      if (!section.classDays.includes(s.weekday)) {
        throw badRequest(`El ${dayName(s.weekday).toLowerCase()} no es día de clase de ${section.label}`);
      }
      if (s.block > blocks.length) throw badRequest("Esa hora no existe en el horario de la jornada");
      if (!own.has(s.assignmentId)) throw badRequest("Esa clase no es de esta sección");
    }
    // ¿Algún docente ya está en otra sección a esa misma hora? Se comparan las horas de verdad: cada
    // jornada tiene las suyas (la 1.ª hora de la nocturna no es la 1.ª de la matutina).
    const sectionList = await listSections(db, schoolId, section.schoolYearId);
    const shiftOfSection = new Map(sectionList.map((x: SectionDto) => [x.id, x.shiftId ?? ""]));
    const timeOf = (sectionId: string, block: number) =>
      (blocksByShift.get(shiftOfSection.get(sectionId) ?? "") ?? []).find((b) => b.number === block);
    const overlaps = (a?: ScheduleBlockDto, b?: ScheduleBlockDto) =>
      Boolean(a && b && a.startsAt < b.endsAt && b.startsAt < a.endsAt);
    const others = await slotsOf(db, schoolId, (s) => s.sectionId !== id);
    const allAssignments = new Map(
      (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId })).map((a) => [a.id, a]),
    );
    const clashes = slots.flatMap((s) => {
      const teacher = own.get(s.assignmentId)?.teacherUserId;
      const mine = timeOf(id, s.block);
      const other = others.find(
        (o) =>
          o.weekday === s.weekday &&
          allAssignments.get(o.assignmentId)?.teacherUserId === teacher &&
          overlaps(mine, timeOf(o.sectionId, o.block)),
      );
      return other
        ? [
            `${dayName(s.weekday)}, ${s.block}.ª hora: ${other.teacherName} ya da clase en ${other.sectionLabel}`,
          ]
        : [];
    });
    if (clashes.length) throw conflict(`El horario cruza docentes. ${clashes.slice(0, 3).join(". ")}.`);

    await db.transaction(async (tx) => {
      await tx
        .delete(scheduleSlots)
        .where(and(eq(scheduleSlots.schoolId, schoolId), eq(scheduleSlots.sectionId, id)));
      if (slots.length)
        await tx.insert(scheduleSlots).values(slots.map((s) => ({ schoolId, sectionId: id, ...s })));
      await audit(tx, request, {
        action: "schedule.section_updated",
        entityType: "section",
        entityId: id,
        data: { label: section.label, classes: slots.length },
      });
    });
    return scheduleOf(blocks, await slotsOf(db, schoolId, (s) => s.sectionId === id), section.classDays);
  });

  /**
   * El horario de quien da clases: todas sus horas, en todas sus secciones. Si da clases en varias
   * jornadas (por ejemplo, la matutina y la de fin de semana), un horario por jornada con sus horas.
   */
  app.get("/schedule/mine", read, async (request): Promise<ScheduleDto> => {
    const schoolId = tenantOf(request);
    const year = await findCurrentYear(db, schoolId);
    const mine = await slotsOf(db, schoolId, (_s, a) => a.teacherUserId === request.auth.userId);
    const sectionList = year ? await listSections(db, schoolId, year.id) : [];
    const blocksByShift = await allBlocks(db, schoolId);
    const assigned = year
      ? await listAssignments(db, schoolId, { schoolYearId: year.id, teacherUserId: request.auth.userId })
      : [];
    const mySections = sectionList.filter((x) => assigned.some((a) => a.sectionId === x.id));
    const groups = new Map<string, { name: string | null; days: Set<number> }>();
    for (const x of mySections) {
      const g = groups.get(x.shiftId ?? "") ?? { name: x.shiftName, days: new Set<number>() };
      for (const d of x.classDays) g.days.add(d);
      groups.set(x.shiftId ?? "", g);
    }
    const shiftOf = new Map(sectionList.map((x) => [x.id, x.shiftId ?? ""]));
    const grids = [...groups.entries()].map(([key, g]) => ({
      shiftName: g.name,
      blocks: blocksByShift.get(key) ?? [],
      slots: mine.filter((s) => shiftOf.get(s.sectionId) === key),
      classDays: [...g.days].sort((a, b) => a - b),
    }));
    const first = grids[0];
    if (grids.length <= 1) {
      return scheduleOf(
        first?.blocks ?? blocksByShift.get("") ?? [],
        mine,
        first?.classDays ?? DEFAULT_CLASS_DAYS,
      );
    }
    return {
      ...scheduleOf(first?.blocks ?? [], mine, first?.classDays ?? DEFAULT_CLASS_DAYS),
      shifts: grids,
    };
  });

  /** El horario de la sección en la que está matriculado el alumno este año. */
  async function studentSchedule(schoolId: string, id: string): Promise<ScheduleDto> {
    const year = await findCurrentYear(db, schoolId);
    const [enrollment] = year
      ? await db
          .select({ sectionId: enrollments.sectionId })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.schoolId, schoolId),
              eq(enrollments.studentId, id),
              eq(enrollments.schoolYearId, year.id),
              eq(enrollments.status, "activa"),
            ),
          )
      : [];
    if (!enrollment) return scheduleOf(await blocksOf(db, schoolId, null), [], DEFAULT_CLASS_DAYS);
    const section = await getSection(db, schoolId, enrollment.sectionId);
    return scheduleOf(
      await blocksOf(db, schoolId, section.shiftId),
      await slotsOf(db, schoolId, (s) => s.sectionId === enrollment.sectionId),
      section.classDays,
    );
  }

  /** Para la familia: el horario de la sección de su hijo. */
  app.get(
    "/family/children/:id/schedule",
    { preHandler: [app.authenticate, requireRole("padre")] },
    async (request): Promise<ScheduleDto> => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      if (!(await childrenOf(db, schoolId, request.auth.userId)).includes(id))
        throw notFound("Alumno no encontrado");
      return studentSchedule(schoolId, id);
    },
  );

  /** Para el alumno: su propio horario. */
  app.get(
    "/student/me/schedule",
    { preHandler: [app.authenticate, requireRole("estudiante")] },
    async (request): Promise<ScheduleDto> => {
      const schoolId = tenantOf(request);
      const id = await studentOf(db, schoolId, request.auth.userId);
      if (!id) throw notFound("Tu cuenta no está ligada a un alumno del centro");
      return studentSchedule(schoolId, id);
    },
  );
}
