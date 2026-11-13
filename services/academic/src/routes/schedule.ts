import { badRequest, conflict, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type AssignmentDto,
  type ScheduleBlockDto,
  type ScheduleDto,
  type ScheduleSlotDto,
  scheduleBlocksInputSchema,
  sectionScheduleInputSchema,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "@escolar/shared";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { enrollments, scheduleBlocks, scheduleSlots } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { childrenOf } from "../lib/family";
import { findCurrentYear, getSection, listAssignments } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const dayName = (weekday: number) => WEEKDAY_LABELS[WEEKDAYS[weekday - 1] ?? "lunes"];

async function blocksOf(db: DbOrTx, schoolId: string): Promise<ScheduleBlockDto[]> {
  return db
    .select({
      number: scheduleBlocks.number,
      startsAt: scheduleBlocks.startsAt,
      endsAt: scheduleBlocks.endsAt,
    })
    .from(scheduleBlocks)
    .where(eq(scheduleBlocks.schoolId, schoolId))
    .orderBy(asc(scheduleBlocks.number));
}

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

  app.get(
    "/schedule/blocks",
    read,
    async (request): Promise<ScheduleBlockDto[]> => blocksOf(db, tenantOf(request)),
  );

  app.put("/schedule/blocks", write, async (request): Promise<ScheduleBlockDto[]> => {
    const schoolId = tenantOf(request);
    const { blocks } = parseOrThrow(scheduleBlocksInputSchema, request.body);
    await db.transaction(async (tx) => {
      await tx.delete(scheduleBlocks).where(eq(scheduleBlocks.schoolId, schoolId));
      if (blocks.length) {
        await tx.insert(scheduleBlocks).values(blocks.map((b, i) => ({ schoolId, number: i + 1, ...b })));
      }
      // Las clases puestas en horas que ya no existen se quitan del horario.
      await tx
        .delete(scheduleSlots)
        .where(and(eq(scheduleSlots.schoolId, schoolId), gt(scheduleSlots.block, blocks.length)));
      await audit(tx, request, { action: "schedule.blocks_updated", data: { blocks: blocks.length } });
    });
    return blocksOf(db, schoolId);
  });

  app.get("/schedule/sections/:id", read, async (request): Promise<ScheduleDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await getSection(db, schoolId, id);
    return {
      blocks: await blocksOf(db, schoolId),
      slots: await slotsOf(db, schoolId, (s) => s.sectionId === id),
    };
  });

  app.put("/schedule/sections/:id", write, async (request): Promise<ScheduleDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { slots } = parseOrThrow(sectionScheduleInputSchema, request.body);
    const section = await getSection(db, schoolId, id);
    const blocks = await blocksOf(db, schoolId);
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
      if (s.block > blocks.length) throw badRequest("Esa hora no existe en el horario del centro");
      if (!own.has(s.assignmentId)) throw badRequest("Esa clase no es de esta sección");
    }
    // ¿Algún docente ya está en otra sección a esa misma hora?
    const others = await slotsOf(db, schoolId, (s) => s.sectionId !== id);
    const allAssignments = new Map(
      (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId })).map((a) => [a.id, a]),
    );
    const clashes = slots.flatMap((s) => {
      const teacher = own.get(s.assignmentId)?.teacherUserId;
      const other = others.find(
        (o) =>
          o.weekday === s.weekday &&
          o.block === s.block &&
          allAssignments.get(o.assignmentId)?.teacherUserId === teacher,
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
    return { blocks, slots: await slotsOf(db, schoolId, (s) => s.sectionId === id) };
  });

  /** El horario de quien da clases: todas sus horas, en todas sus secciones. */
  app.get("/schedule/mine", read, async (request): Promise<ScheduleDto> => {
    const schoolId = tenantOf(request);
    return {
      blocks: await blocksOf(db, schoolId),
      slots: await slotsOf(db, schoolId, (_s, a) => a.teacherUserId === request.auth.userId),
    };
  });

  /** Para la familia: el horario de la sección de su hijo. */
  app.get(
    "/family/children/:id/schedule",
    { preHandler: [app.authenticate, requireRole("padre")] },
    async (request): Promise<ScheduleDto> => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      if (!(await childrenOf(db, schoolId, request.auth.userId)).includes(id))
        throw notFound("Alumno no encontrado");
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
      return {
        blocks: await blocksOf(db, schoolId),
        slots: enrollment ? await slotsOf(db, schoolId, (s) => s.sectionId === enrollment.sectionId) : [],
      };
    },
  );
}
