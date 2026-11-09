import {
  ApiError,
  conflict,
  isUniqueViolation,
  notFound,
  parseOrThrow,
  requireRole,
} from "@escolar/service-kit";
import {
  type CreatedUserDto,
  type DepartmentDto,
  departmentInputSchema,
  districtInputSchema,
  regionalUserInputSchema,
  type ScopedSchoolDto,
} from "@escolar/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { departments, districts, schoolLogos, schools } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { grantAccess, toSchoolDto, toUserDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });

/**
 * Centros que puede ver la sesión según su ámbito:
 * plataforma => todos; departamento => los de sus distritos; distrito => los suyos; centro => el propio.
 */
async function schoolsInScope(db: Db, request: FastifyRequest): Promise<ScopedSchoolDto[]> {
  const { role, schoolId, districtId, departmentId } = request.auth;
  const base = db
    .select({ school: schools, districtName: districts.name })
    .from(schools)
    .leftJoin(districts, eq(districts.id, schools.districtId));

  let rows: Array<{ school: typeof schools.$inferSelect; districtName: string | null }>;
  if (role === "superadmin") rows = await base.orderBy(asc(schools.name));
  else if (role === "director_departamental" && departmentId) {
    rows = await base
      .where(eq(districts.departmentId, departmentId))
      .orderBy(asc(districts.name), asc(schools.name));
  } else if (role === "director_distrital" && districtId) {
    rows = await base.where(eq(schools.districtId, districtId)).orderBy(asc(schools.name));
  } else if (schoolId) rows = await base.where(eq(schools.id, schoolId));
  else rows = [];
  return rows.map((r) => ({ ...toSchoolDto(r.school), districtName: r.districtName }));
}

export async function regionRoutes(app: FastifyInstance, { db }: IdentityDeps) {
  const platform = { preHandler: [app.authenticate, requireRole("superadmin")] };

  // ── Departamentos y distritos (equipo de la plataforma) ──
  app.get(
    "/departments",
    {
      preHandler: [
        app.authenticate,
        requireRole("superadmin", "director_departamental", "director_distrital"),
      ],
    },
    async (request): Promise<DepartmentDto[]> => {
      const { role, departmentId, districtId } = request.auth;
      let deps = await db.select().from(departments).orderBy(asc(departments.code));
      const allDistricts = await db.select().from(districts).orderBy(asc(districts.name));
      if (role === "director_departamental") deps = deps.filter((d) => d.id === departmentId);
      if (role === "director_distrital") {
        const own = allDistricts.find((d) => d.id === districtId);
        deps = deps.filter((d) => d.id === own?.departmentId);
      }
      return deps.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        districts: allDistricts
          .filter((x) => x.departmentId === d.id && (role !== "director_distrital" || x.id === districtId))
          .map((x) => ({ id: x.id, departmentId: x.departmentId, name: x.name })),
      }));
    },
  );

  app.post("/departments", platform, async (request, reply) => {
    const input = parseOrThrow(departmentInputSchema, request.body);
    try {
      const [department] = await db.insert(departments).values(input).returning();
      return reply.status(201).send({ ...department, districts: [] });
    } catch (err) {
      if (isUniqueViolation(err, "departments_code_unique")) {
        throw conflict(`Ya existe el departamento con código ${input.code}`);
      }
      throw err;
    }
  });

  app.post("/departments/:id/districts", platform, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(districtInputSchema, request.body);
    const [department] = await db.select().from(departments).where(eq(departments.id, id));
    if (!department) throw notFound("Departamento no encontrado");
    try {
      const [district] = await db
        .insert(districts)
        .values({ departmentId: id, name: input.name })
        .returning();
      return reply.status(201).send(district);
    } catch (err) {
      if (isUniqueViolation(err, "districts_name_unique")) {
        throw conflict(`Ya existe el distrito ${input.name} en ${department.name}`);
      }
      throw err;
    }
  });

  /** Dar acceso a una dirección departamental o distrital. */
  app.post("/regional-users", platform, async (request, reply) => {
    const input = parseOrThrow(regionalUserInputSchema, request.body);
    if (input.departmentId) {
      const [d] = await db.select().from(departments).where(eq(departments.id, input.departmentId));
      if (!d) throw notFound("Departamento no encontrado");
    }
    if (input.districtId) {
      const [d] = await db.select().from(districts).where(eq(districts.id, input.districtId));
      if (!d) throw notFound("Distrito no encontrado");
    }
    const result = await db.transaction(async (tx) => {
      const granted = await grantAccess(tx, input);
      await audit(tx, request, {
        action: "membership.regional_created",
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: granted.user.id,
        data: { role: input.role, departmentId: input.departmentId, districtId: input.districtId },
      });
      return granted;
    });
    const body: CreatedUserDto = {
      ...toUserDto(result.user, result.membership),
      linkedExisting: result.linkedExisting,
    };
    return reply.status(201).send(body);
  });

  // ── Lo que puede ver cada sesión ──
  app.get("/scope/schools", { preHandler: app.authenticate }, async (request) => schoolsInScope(db, request));

  /** Logo de un centro dentro del ámbito de la sesión (para el tablero departamental). */
  app.get("/scope/schools/:id/logo", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const visible = await schoolsInScope(db, request);
    if (!visible.some((s) => s.id === id)) throw notFound("Centro no encontrado");
    const [logo] = await db.select().from(schoolLogos).where(eq(schoolLogos.schoolId, id));
    if (!logo) throw new ApiError(404, "not_found", "El centro no tiene logo");
    return reply
      .header("content-type", logo.mimeType)
      .header("cache-control", "private, max-age=86400")
      .header("x-content-type-options", "nosniff")
      .send(logo.data);
  });
}

/** Para pruebas y seeds: ids de los centros de un distrito. */
export async function schoolIdsOfDistricts(db: Db, districtIds: string[]): Promise<string[]> {
  if (districtIds.length === 0) return [];
  const rows = await db
    .select({ id: schools.id })
    .from(schools)
    .where(inArray(schools.districtId, districtIds));
  return rows.map((r) => r.id);
}
