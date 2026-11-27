import { requireRole, tenantOf } from "@escolar/service-kit";
import type { TeacherTodayDto } from "@escolar/shared";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  attendanceRecords,
  classTasks,
  scheduleBlocks,
  scheduleSlots,
  sections,
  taskSubmissions,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { dayOffFor } from "../lib/calendar";
import { teacherClasses } from "../lib/evaluation";

/** 1 = lunes … 7 = domingo. */
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/**
 * El inicio del maestro: qué clases tiene hoy (según el horario y los días de su jornada), en qué
 * secciones falta pasar asistencia y qué tareas tienen entregas sin calificar.
 */
export async function teacherTodayRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const staff = {
    preHandler: [app.authenticate, requireRole("docente", "coordinador", "admin")],
  };

  app.get("/teacher/today", staff, async (request): Promise<TeacherTodayDto> => {
    const schoolId = tenantOf(request);
    const date = today();
    const weekday = weekdayOf(date);
    const mine = await teacherClasses(db, schoolId, request.auth.userId, date);
    const ids = mine.map((c) => c.assignment.id);
    const [dayOff, slots, taken, grading] = await Promise.all([
      dayOffFor(db, schoolId, date),
      ids.length
        ? db
            .select({
              assignmentId: scheduleSlots.assignmentId,
              weekday: scheduleSlots.weekday,
              startsAt: scheduleBlocks.startsAt,
              endsAt: scheduleBlocks.endsAt,
            })
            .from(scheduleSlots)
            .innerJoin(sections, eq(sections.id, scheduleSlots.sectionId))
            .leftJoin(
              scheduleBlocks,
              and(
                eq(scheduleBlocks.schoolId, scheduleSlots.schoolId),
                eq(scheduleBlocks.number, scheduleSlots.block),
                sql`${scheduleBlocks.shiftId} is not distinct from ${sections.shiftId}`,
              ),
            )
            .where(and(eq(scheduleSlots.schoolId, schoolId), inArray(scheduleSlots.assignmentId, ids)))
        : [],
      ids.length
        ? db
            .selectDistinct({ sectionId: attendanceRecords.sectionId })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.schoolId, schoolId),
                eq(attendanceRecords.date, date),
                inArray(
                  attendanceRecords.sectionId,
                  mine.map((c) => c.assignment.sectionId),
                ),
              ),
            )
        : [],
      ids.length
        ? db
            .select({
              taskId: classTasks.id,
              assignmentId: classTasks.assignmentId,
              title: classTasks.title,
              pending: sql<number>`count(*)::int`,
            })
            .from(taskSubmissions)
            .innerJoin(classTasks, eq(classTasks.id, taskSubmissions.taskId))
            .where(
              and(
                inArray(classTasks.assignmentId, ids),
                isNotNull(classTasks.activityId),
                isNotNull(taskSubmissions.submittedAt),
                isNull(taskSubmissions.gradedAt),
              ),
            )
            .groupBy(classTasks.id, classTasks.assignmentId, classTasks.title)
        : [],
    ]);
    const takenSet = new Set(taken.map((t) => t.sectionId));
    const classes: TeacherTodayDto["classes"] = [];
    for (const c of mine) {
      const a = c.assignment;
      if (!a.classDays.includes(weekday)) continue;
      const own = slots.filter((s) => s.assignmentId === a.id);
      const todays = own.filter((s) => s.weekday === weekday);
      // Con horario armado, solo las horas de hoy; sin horario, la clase sale sin hora.
      if (own.length && !todays.length) continue;
      const times = todays
        .map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt }))
        .sort((x, y) => (x.startsAt ?? "").localeCompare(y.startsAt ?? ""));
      for (const t of times.length ? [times[0]] : [{ startsAt: null, endsAt: null }]) {
        classes.push({
          assignmentId: a.id,
          subjectName: a.subjectName,
          sectionId: a.sectionId,
          sectionLabel: a.sectionLabel,
          startsAt: t?.startsAt ?? null,
          endsAt: times.at(-1)?.endsAt ?? t?.endsAt ?? null,
          substituting: c.substituting,
          attendanceTaken: takenSet.has(a.sectionId),
        });
      }
    }
    classes.sort((x, y) => (x.startsAt ?? "99").localeCompare(y.startsAt ?? "99"));
    const labelOf = new Map(
      mine.map((c) => [c.assignment.id, `${c.assignment.subjectName} · ${c.assignment.sectionLabel}`]),
    );
    return {
      date,
      dayOff,
      classes,
      toGrade: grading
        .map((g) => ({ ...g, label: labelOf.get(g.assignmentId) ?? "" }))
        .sort((x, y) => y.pending - x.pending)
        .slice(0, 8),
    };
  });
}
