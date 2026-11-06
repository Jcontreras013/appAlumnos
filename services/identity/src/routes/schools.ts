import { conflict, isUniqueViolation, notFound, parseOrThrow, requireRole } from "@escolar/service-kit";
import { createSchoolInputSchema, type SchoolDto, type UserDto } from "@escolar/shared";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { schools, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { insertUser, toSchoolDto, toUserDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });
const statusBody = z.object({ active: z.boolean() });

/** Administración de colegios (tenants). Solo el equipo de la plataforma (superadmin). */
export async function schoolRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = { preHandler: [app.authenticate, requireRole("superadmin")] };

  app.get("/schools", guard, async (): Promise<SchoolDto[]> => {
    const rows = await db.select().from(schools).orderBy(asc(schools.name));
    return rows.map(toSchoolDto);
  });

  app.post("/schools", guard, async (request, reply): Promise<{ school: SchoolDto; admin: UserDto }> => {
    const input = parseOrThrow(createSchoolInputSchema, request.body);
    try {
      const result = await db.transaction(async (tx) => {
        const [school] = await tx
          .insert(schools)
          .values({ name: input.name, slug: input.slug, rtn: input.rtn ?? null })
          .returning();
        if (!school) throw new Error("No se pudo crear el colegio");
        const admin = await insertUser(tx, { ...input.admin, schoolId: school.id, role: "admin" });
        await audit(tx, request, {
          action: "school.created",
          schoolId: school.id,
          actorUserId: request.auth.userId,
          entityType: "school",
          entityId: school.id,
          data: { slug: school.slug, adminUserId: admin.id },
        });
        return { school: toSchoolDto(school), admin: toUserDto(admin) };
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (isUniqueViolation(err, "schools_slug_unique")) {
        throw conflict(`Ya existe un colegio con el identificador "${input.slug}"`);
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
        const members = await tx.select({ id: users.id }).from(users).where(eq(users.schoolId, id));
        for (const member of members) await tokens.revokeAllForUser(tx, member.id);
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
}
