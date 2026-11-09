import { notFound, parseOrThrow, requireRole } from "@escolar/service-kit";
import {
  isIsoDate,
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
import { ensureDefaultPeriods, followUp } from "../lib/evaluation";
import { bearerOf } from "../lib/identity-client";
import { findCurrentYear, listAssignments, listSections } from "../lib/queries";
import { coverageFor } from "../lib/staff";

const dateQuery = z.object({ fecha: z.string().refine(isIsoDate).optional() });
const idParams = z.object({ id: z.uuid() });

async function summarize(
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
    // Un centro a la vez: con cientos de escuelas sigue siendo rápido; si crece, se agrupa en SQL.
    const schools: RegionalSchoolSummaryDto[] = [];
    for (const school of scope) schools.push(await summarize(db, school, date));

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
}
