import { badRequest, notFound, parseOrThrow, requireRole } from "@escolar/service-kit";
import {
  type AttendanceStatus,
  addDays,
  attendanceRate,
  isIsoDate,
  mondayOf,
  PILOT_INDICATORS,
  type PilotIndicatorsDto,
  type PilotSchoolDto,
  type RegionalOverviewDto,
  type RegionalSchoolDetailDto,
  type RegionalSchoolSummaryDto,
  type RegionalSectionAttendanceDto,
  type RegionalStudentDto,
  type SchoolFollowUpDto,
  type ScopedSchoolDto,
  type SectionDto,
} from "@escolar/shared";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { attendanceRecords, auditEvents, enrollments, studentFollowUps } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { mapLimit } from "../lib/concurrency";
import { ensureDefaultPeriods, followUp } from "../lib/evaluation";
import { familyChild } from "../lib/family";
import { bearerOf } from "../lib/identity-client";
import { pilotForSchool } from "../lib/pilot";
import { weekBoard } from "../lib/plans";
import { findCurrentYear, listAssignments, listSections } from "../lib/queries";
import { coverageFor } from "../lib/staff";

/** Centros que se calculan a la vez en las vistas regionales (el pool de la base tiene 10 conexiones). */
export const REGIONAL_CONCURRENCY = 4;
const dateQuery = z.object({ fecha: z.string().refine(isIsoDate).optional() });
const rangeQuery = z.object({
  desde: z.string().refine(isIsoDate, { error: "Fecha inválida" }).optional(),
  hasta: z.string().refine(isIsoDate, { error: "Fecha inválida" }).optional(),
});
const idParams = z.object({ id: z.uuid() });
const studentParams = z.object({ id: z.uuid(), studentId: z.uuid() });

/**
 * Resumen de un centro para el tablero. `given` permite reusar el seguimiento ya calculado cuando
 * la misma petición también necesita su detalle.
 */
export async function summarize(
  db: DbOrTx,
  school: ScopedSchoolDto,
  date: string,
  given?: SchoolFollowUpDto,
): Promise<RegionalSchoolSummaryDto> {
  const year = await findCurrentYear(db, school.id);
  const base = {
    schoolId: school.id,
    schoolName: school.name,
    districtName: school.districtName,
    logoVersion: school.logoVersion,
    schoolYear: year?.name ?? null,
  };
  if (!year) {
    return {
      ...base,
      students: 0,
      sections: 0,
      teachers: 0,
      classes: 0,
      teachersOnLeave: 0,
      uncoveredClasses: 0,
      attendanceRate7d: null,
      studentsAtRisk: 0,
      periodName: null,
      periodClosesOn: null,
      gradeProgress: { complete: 0, total: 0 },
      behindOnGrades: false,
      plans: { delivered: 0, total: 0, overdue: 0 },
    };
  }
  await ensureDefaultPeriods(db, year);
  const follow = given ?? (await followUp(db, school.id, date));
  const [students] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.schoolId, school.id),
        eq(enrollments.schoolYearId, year.id),
        eq(enrollments.status, "activa"),
      ),
    );
  const sections = await listSections(db, school.id, year.id);
  const assignments = await listAssignments(db, school.id, { schoolYearId: year.id });
  const coverage = await coverageFor(db, school.id, date);
  return {
    ...base,
    students: students?.n ?? 0,
    sections: sections.length,
    teachers: new Set(assignments.map((a) => a.teacherUserId)).size,
    classes: assignments.length,
    teachersOnLeave: coverage.teachersOnLeave,
    uncoveredClasses: coverage.totals.sin_cubrir,
    attendanceRate7d: follow.attendance.rate7d,
    studentsAtRisk: follow.studentsAtRisk.length,
    periodName: follow.period?.name ?? null,
    periodClosesOn: follow.period?.closesOn ?? null,
    gradeProgress: { complete: follow.gradeProgress.complete, total: follow.gradeProgress.total },
    plans: { delivered: follow.plans.delivered, total: follow.plans.total, overdue: follow.plans.overdue },
    behindOnGrades:
      follow.daysToClose !== null &&
      follow.daysToClose <= 7 &&
      follow.gradeProgress.total > 0 &&
      follow.gradeProgress.complete < follow.gradeProgress.total,
  };
}

/** Asistencia de los últimos 7 días (hasta `date`) de cada sección, de la más baja a la más alta. */
async function attendanceBySection(
  db: DbOrTx,
  schoolId: string,
  sections: SectionDto[],
  date: string,
): Promise<RegionalSectionAttendanceDto[]> {
  const records = await db
    .select({
      sectionId: attendanceRecords.sectionId,
      date: attendanceRecords.date,
      status: attendanceRecords.status,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        gte(attendanceRecords.date, addDays(date, -6)),
        lte(attendanceRecords.date, date),
      ),
    );
  const bySection = new Map<string, { statuses: AttendanceStatus[]; days: Set<string> }>();
  for (const r of records) {
    const entry = bySection.get(r.sectionId) ?? { statuses: [], days: new Set<string>() };
    entry.statuses.push(r.status);
    entry.days.add(r.date);
    bySection.set(r.sectionId, entry);
  }
  return sections
    .map((s) => {
      const entry = bySection.get(s.id);
      return {
        sectionId: s.id,
        sectionLabel: s.label,
        rate: entry ? attendanceRate(entry.statuses) : null,
        recordedDays: entry?.days.size ?? 0,
      };
    })
    .sort((a, b) => (a.rate ?? 2) - (b.rate ?? 2));
}

/**
 * Tablero de la dirección departamental o distrital. Qué centros entran lo decide identity
 * (con el token de la sesión): academic nunca decide por su cuenta quién ve qué escuela.
 */
export async function regionalRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const guard = {
    preHandler: [app.authenticate, requireRole("director_departamental", "director_distrital", "superadmin")],
  };

  /** El centro, solo si identity dice que está en el ámbito de quien pregunta (si no, 404). */
  async function scopedSchool(request: FastifyRequest, id: string): Promise<ScopedSchoolDto> {
    const school = (await identity.getScopeSchools(bearerOf(request))).find((s) => s.id === id);
    if (!school) throw notFound("Centro no encontrado");
    return school;
  }

  app.get("/regional/overview", guard, async (request): Promise<RegionalOverviewDto> => {
    const { fecha } = parseOrThrow(dateQuery, request.query);
    const date = fecha ?? today();
    const scope = (await identity.getScopeSchools(bearerOf(request))).filter((s) => s.active);
    // Varios centros a la vez (sin agotar las conexiones): con 100 centros baja de segundos a menos.
    const schools: RegionalSchoolSummaryDto[] = await mapLimit(scope, REGIONAL_CONCURRENCY, (school) =>
      summarize(db, school, date),
    );

    const sum = (key: keyof RegionalSchoolSummaryDto) =>
      schools.reduce((acc, s) => acc + (typeof s[key] === "number" ? (s[key] as number) : 0), 0);
    return {
      date,
      schools,
      totals: {
        schools: schools.length,
        students: sum("students"),
        sections: sum("sections"),
        teachers: sum("teachers"),
        classes: sum("classes"),
        teachersOnLeave: sum("teachersOnLeave"),
        uncoveredClasses: sum("uncoveredClasses"),
        schoolsWithUncoveredClasses: schools.filter((s) => s.uncoveredClasses > 0).length,
        studentsAtRisk: sum("studentsAtRisk"),
        schoolsBehindOnGrades: schools.filter((s) => s.behindOnGrades).length,
        plansDelivered: schools.reduce((acc, s) => acc + s.plans.delivered, 0),
        plansTotal: schools.reduce((acc, s) => acc + s.plans.total, 0),
        plansOverdue: schools.reduce((acc, s) => acc + s.plans.overdue, 0),
        attendanceRate7d: (() => {
          const withData = schools.filter((s) => s.attendanceRate7d !== null && s.students > 0);
          const weight = withData.reduce((acc, s) => acc + s.students, 0);
          return weight
            ? withData.reduce((acc, s) => acc + (s.attendanceRate7d ?? 0) * s.students, 0) / weight
            : null;
        })(),
      },
    };
  });

  app.get("/regional/schools/:id", guard, async (request): Promise<RegionalSchoolDetailDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { fecha } = parseOrThrow(dateQuery, request.query);
    const date = fecha ?? today();
    const school = await scopedSchool(request, id);
    const year = await findCurrentYear(db, id);
    if (year) await ensureDefaultPeriods(db, year);
    const follow = await followUp(db, id, date);
    const sections = year ? await listSections(db, id, year.id) : [];
    const assignments = year ? await listAssignments(db, id, { schoolYearId: year.id }) : [];
    return {
      summary: await summarize(db, school, date, follow),
      coverage: await coverageFor(db, id, date),
      sections,
      studentsAtRisk: follow.studentsAtRisk,
      gradeProgress: follow.gradeProgress.items,
      plans: assignments.length ? (await weekBoard(db, id, assignments, mondayOf(date), date)).rows : [],
      attendanceBySection: await attendanceBySection(db, id, sections, date),
    };
  });

  /**
   * Ficha de un alumno de un centro del ámbito, de solo lectura: lo que ve su familia, por qué está
   * en riesgo y el seguimiento que registró la escuela. Cada consulta queda en la bitácora del centro.
   */
  app.get(
    "/regional/schools/:id/students/:studentId",
    guard,
    async (request): Promise<RegionalStudentDto> => {
      const { id, studentId } = parseOrThrow(studentParams, request.params);
      const { fecha } = parseOrThrow(dateQuery, request.query);
      const date = fecha ?? today();
      const school = await scopedSchool(request, id);
      // familyChild responde 404 si el alumno no es de este centro.
      const child = await familyChild(db, id, studentId, date);
      const follow = await followUp(db, id, date);
      const followUps = await db
        .select()
        .from(studentFollowUps)
        .where(and(eq(studentFollowUps.schoolId, id), eq(studentFollowUps.studentId, studentId)))
        .orderBy(desc(studentFollowUps.date), desc(studentFollowUps.createdAt));
      await db.insert(auditEvents).values({
        schoolId: id,
        actorUserId: request.auth.userId,
        action: "student.viewed_by_region",
        entityType: "student",
        entityId: studentId,
        data: null,
        requestId: request.id,
      });
      return {
        school: {
          id: school.id,
          name: school.name,
          districtName: school.districtName,
          logoVersion: school.logoVersion,
        },
        child,
        risk: follow.studentsAtRisk.find((s) => s.studentId === studentId) ?? null,
        followUps: followUps.map((f) => ({
          id: f.id,
          kind: f.kind,
          date: f.date,
          notes: f.notes,
          authorName: f.authorName,
        })),
      };
    },
  );

  /** Indicadores del piloto por centro y en total, en un período (por defecto, las últimas 4 semanas). */
  app.get("/regional/pilot", guard, async (request): Promise<PilotIndicatorsDto> => {
    const { desde, hasta } = parseOrThrow(rangeQuery, request.query);
    const to = hasta ?? today();
    const from = desde ?? addDays(to, -27);
    if (from > to) throw badRequest("La fecha inicial debe ser anterior a la final");
    const token = bearerOf(request);
    const [scope, activity] = await Promise.all([
      identity.getScopeSchools(token),
      identity.getScopeActivity(token),
    ]);
    const families = new Set(activity.activatedFamilyUserIds);
    const results = await mapLimit(
      scope.filter((s) => s.active),
      REGIONAL_CONCURRENCY,
      (school) =>
        pilotForSchool(
          db,
          school,
          activity.schools.find((a) => a.schoolId === school.id),
          families,
          from,
          to,
          today(),
        ),
    );
    const schools: PilotSchoolDto[] = results.map((r) => r.school);
    const days = Math.max(0, ...results.map((r) => r.businessDays));
    const totals = Object.fromEntries(
      PILOT_INDICATORS.map((k) => [
        k,
        {
          met: schools.reduce((acc, s) => acc + s.measures[k].met, 0),
          total: schools.reduce((acc, s) => acc + s.measures[k].total, 0),
        },
      ]),
    ) as PilotIndicatorsDto["totals"];
    return { from, to, businessDays: days, schools, totals };
  });
}
