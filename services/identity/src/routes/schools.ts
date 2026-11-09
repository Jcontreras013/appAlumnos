import { conflict, isUniqueViolation, notFound, parseOrThrow, requireRole } from "@escolar/service-kit";
import { createSchoolInputSchema, type SchoolDto, type UserDto } from "@escolar/shared";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { districts, memberships, schools } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { grantAccess, toSchoolDto, toUserDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });
const statusBody = z.object({ active: z.boolean() });
const districtBody = z.object({ districtId: z.uuid().nullable() });

/** Administración de colegios (tenants). Solo el equipo de la plataforma (superadmin). */
export async function schoolRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = { preHandler: [app.authenticate, requireRole("superadmin")] };

  app.get("/schools", guard, async (): Promise<SchoolDto[]> => {
    const rows = await db.select().from(schools).orderBy(asc(schools.name));
    return rows.map(toSchoolDto);
  });

  app.post("/schools", guard, async (request, reply): Promise<{ school: SchoolDto; admin: UserDto }> => {
    const input = parseOrThrow(createSchoolInputSchema, request.body);
    if (input.districtId) {
      const [district] = await db.select().from(districts).where(eq(districts.id, input.districtId));
      if (!district) throw notFound("Distrito no encontrado");
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [school] = await tx
          .insert(schools)
          .values({
            name: input.name,
            slug: input.slug,
            rtn: input.rtn ?? null,
            code: input.code ?? null,
            sector: input.sector,
            districtId: input.districtId ?? null,
          })
          .returning();
        if (!school) throw new Error("No se pudo crear el colegio");
        // Si la persona ya tiene cuenta (p. ej. dirige otra escuela), se le agrega este centro.
        const admin = await grantAccess(tx, { ...input.admin, schoolId: school.id, role: "admin" });
        await audit(tx, request, {
          action: "school.created",
          schoolId: school.id,
          actorUserId: request.auth.userId,
          entityType: "school",
          entityId: school.id,
          data: { slug: school.slug, adminUserId: admin.user.id, districtId: school.districtId },
        });
        return { school: toSchoolDto(school), admin: toUserDto(admin.user, admin.membership) };
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (isUniqueViolation(err, "schools_slug_unique")) {
        throw conflict(`Ya existe un colegio con el identificador "${input.slug}"`);
      }
      if (isUniqueViolation(err, "schools_code_unique")) {
        throw conflict(`Ya existe un centro con el código "${input.code}"`);
      }
      throw err;
    }
  });

  app.post("/schools/:id/status", guard, async (request): Promise<SchoolDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { active } = parseOrThrow(statusBody, request.body);
    return db.transaction(async (tx) => {
      const [school] = await tx.update(schools).set({ active }).where(eq(schools.id, id)).returning();
      if (!school) throw notFound("Colegio no encontrado");
      if (!active) {
        // Desactivar un colegio cierra todas las sesiones de su personal y familias.
        const members = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.schoolId, id));
        for (const member of members) await tokens.revokeForMembership(tx, member.id);
      }
      await audit(tx, request, {
        action: active ? "school.activated" : "school.deactivated",
        schoolId: school.id,
        actorUserId: request.auth.userId,
        entityType: "school",
        entityId: school.id,
      });
      return toSchoolDto(school);
    });
  });

  /** Ubicar un centro en su distrito (o sacarlo, para colegios privados independientes). */
  app.post("/schools/:id/district", guard, async (request): Promise<SchoolDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { districtId } = parseOrThrow(districtBody, request.body);
    if (districtId) {
      const [district] = await db.select().from(districts).where(eq(districts.id, districtId));
      if (!district) throw notFound("Distrito no encontrado");
    }
    return db.transaction(async (tx) => {
      const [school] = await tx.update(schools).set({ districtId }).where(eq(schools.id, id)).returning();
      if (!school) throw notFound("Colegio no encontrado");
      await audit(tx, request, {
        action: "school.district_changed",
        schoolId: id,
        actorUserId: request.auth.userId,
        entityType: "school",
        entityId: id,
        data: { districtId },
      });
      return toSchoolDto(school);
    });
  });
}
