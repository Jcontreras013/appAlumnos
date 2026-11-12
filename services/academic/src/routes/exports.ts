import { requireRole, tenantOf } from "@escolar/service-kit";
import type { RegionalExportDto, SchoolExportDto } from "@escolar/shared";
import type { FastifyInstance } from "fastify";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { schoolExport, studentRows } from "../lib/exports";
import { bearerOf } from "../lib/identity-client";
import { findCurrentYear } from "../lib/queries";
import { summarize } from "./regional";

/**
 * Descarga de los datos para Excel. Son datos de menores: cada descarga queda en la bitácora con
 * quién la hizo, y cada quien solo descarga lo de su centro o su ámbito.
 */
export async function exportRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  app.get(
    "/export/school",
    { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] },
    async (request): Promise<SchoolExportDto> => {
      const schoolId = tenantOf(request);
      const data = await schoolExport(db, schoolId, today());
      await audit(db, request, {
        action: "export.school",
        data: { students: data.students.length, grades: data.grades.length },
      });
      return data;
    },
  );

  app.get(
    "/regional/export",
    {
      preHandler: [
        app.authenticate,
        requireRole("director_departamental", "director_distrital", "superadmin"),
      ],
    },
    async (request): Promise<RegionalExportDto> => {
      const date = today();
      const scope = (await identity.getScopeSchools(bearerOf(request))).filter((s) => s.active);
      const result: RegionalExportDto = { generatedOn: date, schools: [], students: [] };
      for (const school of scope) {
        result.schools.push({ ...(await summarize(db, school, date)), schoolCode: school.code });
        const year = await findCurrentYear(db, school.id);
        for (const row of await studentRows(db, school.id, year?.id ?? null)) {
          result.students.push({
            schoolName: school.name,
            schoolCode: school.code,
            districtName: school.districtName,
            ...row,
          });
        }
      }
      await audit(db, request, {
        action: "export.regional",
        data: { schools: result.schools.length, students: result.students.length },
      });
      return result;
    },
  );
}
