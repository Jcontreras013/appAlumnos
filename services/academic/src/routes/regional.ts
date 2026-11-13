import { badRequest, notFound, parseOrThrow, requireRole } from "@escolar/service-kit";
import {
  addDays,
  isIsoDate,
  PILOT_INDICATORS,
  type PilotIndicatorsDto,
  type PilotSchoolDto,
  type RegionalOverviewDto,
  type RegionalSchoolDetailDto,
  type RegionalSchoolSummaryDto,
  type ScopedSchoolDto,
} from "@escolar/shared";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { enrollments } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { mapLimit } from "../lib/concurrency";
import { ensureDefaultPeriods, followUp } from "../lib/evaluation";
import { bearerOf } from "../lib/identity-client";
import { pilotForSchool } from "../lib/pilot";
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

export async function summarize(
  db: DbOrTx,
  school: ScopedSchoolDto,
  date: string,
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
  const follow = await followUp(db, school.id, date);
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

/**
 * Tablero de la dirección departamental o distrital. Qué centros entran lo decide identity
 * (con el token de la sesión): academic nunca decide por su cuenta quién ve qué escuela.
 */
export async function regionalRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const guard = {
    preHandler: [app.authenticate, requireRole("director_departamental", "director_distrital", "superadmin")],
  };

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
    const school = (await identity.getScopeSchools(bearerOf(request))).find((s) => s.id === id);
    if (!school) throw notFound("Centro no encontrado");
    const year = await findCurrentYear(db, id);
    return {
      summary: await summarize(db, school, date),
      coverage: await coverageFor(db, id, date),
      sections: year ? await listSections(db, id, year.id) : [],
    };
  });

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
