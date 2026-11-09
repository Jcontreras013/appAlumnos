import { ApiError, badRequest, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import { LOGO_MAX_BYTES, logoInputSchema, type SchoolDto } from "@escolar/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { schoolLogos, schools } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { detectImageType } from "../lib/logo";
import { toSchoolDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });

/**
 * Logo de cada colegio. Lo sube su administrador (o el equipo de la plataforma al dar de alta el
 * colegio) y lo ve cualquier usuario del colegio: aparece en el panel y en los documentos en PDF.
 */
export async function logoRoutes(app: FastifyInstance, { db }: IdentityDeps) {
  async function saveLogo(request: FastifyRequest, schoolId: string): Promise<SchoolDto> {
    const { image } = parseOrThrow(logoInputSchema, request.body);
    const data = Buffer.from(image, "base64");
    if (data.length === 0) throw badRequest("La imagen está vacía");
    if (data.length > LOGO_MAX_BYTES) throw badRequest("El logo pesa más de 300 KB");
    const mimeType = detectImageType(data);
    if (!mimeType) throw badRequest("El logo debe ser una imagen PNG, JPG o WebP");

    return db.transaction(async (tx) => {
      const now = new Date();
      const [school] = await tx
        .update(schools)
        .set({ logoUpdatedAt: now })
        .where(eq(schools.id, schoolId))
        .returning();
      if (!school) throw notFound("Colegio no encontrado");
      await tx
        .insert(schoolLogos)
        .values({ schoolId, mimeType, data, updatedAt: now })
        .onConflictDoUpdate({ target: schoolLogos.schoolId, set: { mimeType, data, updatedAt: now } });
      await audit(tx, request, {
        action: "school.logo_updated",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "school",
        entityId: schoolId,
        data: { mimeType, bytes: data.length },
      });
      return toSchoolDto(school);
    });
  }

  app.put("/school/logo", { preHandler: [app.authenticate, requireRole("admin")] }, async (request) =>
    saveLogo(request, tenantOf(request)),
  );

  app.put(
    "/schools/:id/logo",
    { preHandler: [app.authenticate, requireRole("superadmin")] },
    async (request) => saveLogo(request, parseOrThrow(idParams, request.params).id),
  );

  app.delete(
    "/school/logo",
    { preHandler: [app.authenticate, requireRole("admin")] },
    async (request): Promise<SchoolDto> => {
      const schoolId = tenantOf(request);
      return db.transaction(async (tx) => {
        await tx.delete(schoolLogos).where(eq(schoolLogos.schoolId, schoolId));
        const [school] = await tx
          .update(schools)
          .set({ logoUpdatedAt: null })
          .where(eq(schools.id, schoolId))
          .returning();
        if (!school) throw notFound("Colegio no encontrado");
        await audit(tx, request, {
          action: "school.logo_removed",
          schoolId,
          actorUserId: request.auth.userId,
          entityType: "school",
          entityId: schoolId,
        });
        return toSchoolDto(school);
      });
    },
  );

  /** La imagen en sí. Cualquier usuario del colegio la puede ver (solo la de su propio colegio). */
  app.get("/school/logo", { preHandler: app.authenticate }, async (request, reply) => {
    const schoolId = tenantOf(request);
    const [logo] = await db.select().from(schoolLogos).where(eq(schoolLogos.schoolId, schoolId));
    if (!logo) throw new ApiError(404, "not_found", "El colegio no tiene logo");
    return reply
      .header("content-type", logo.mimeType)
      .header("cache-control", "private, max-age=86400")
      .header("x-content-type-options", "nosniff")
      .send(logo.data);
  });
}
