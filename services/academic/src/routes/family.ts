import {
  ApiError,
  badRequest,
  conflict,
  isUniqueViolation,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  type FamilyAccountDto,
  type FamilyChildDto,
  type FamilyChildSummaryDto,
  type PortalAccessDto,
  portalAccessInputSchema,
  type SectionFamilyAccessDto,
  sectionFamilyAccessInputSchema,
} from "@escolar/shared";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { enrollments, guardians, studentGuardians, students } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { childrenOf, familyChild, summarize } from "../lib/family";
import { bearerOf } from "../lib/identity-client";
import { getSection } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });

async function guardianOrThrow(db: DbOrTx, schoolId: string, id: string) {
  const [guardian] = await db
    .select()
    .from(guardians)
    .where(and(eq(guardians.schoolId, schoolId), eq(guardians.id, id)));
  if (!guardian) throw notFound("Encargado no encontrado");
  return guardian;
}

async function childrenNames(db: DbOrTx, guardianId: string) {
  const rows = await db
    .select({ firstNames: students.firstNames, lastNames: students.lastNames })
    .from(studentGuardians)
    .innerJoin(students, eq(students.id, studentGuardians.studentId))
    .where(eq(studentGuardians.guardianId, guardianId))
    .orderBy(asc(students.firstNames));
  return rows.map((r) => `${r.firstNames} ${r.lastNames}`);
}

/**
 * Portal de familias. La secretaría o la dirección le da acceso a un encargado desde la ficha del
 * alumno (identity crea la cuenta o enlaza la que ya tenga) y la familia ve notas, asistencia y
 * tareas de sus hijos, solo de los suyos.
 */
export async function familyRoutes(app: FastifyInstance, { db, identity, today }: AcademicDeps) {
  const office = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };
  const staff = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };
  const family = { preHandler: [app.authenticate, requireRole("padre")] };

  async function accessDto(
    guardian: typeof guardians.$inferSelect,
    account: FamilyAccountDto,
  ): Promise<PortalAccessDto> {
    return {
      ...account,
      guardianId: guardian.id,
      guardianName: guardian.fullName,
      children: await childrenNames(db, guardian.id),
    };
  }

  async function linkAccount(
    request: FastifyRequest,
    guardianId: string,
    account: FamilyAccountDto,
    extra: Record<string, unknown> = {},
  ) {
    await db.transaction(async (tx) => {
      await tx
        .update(guardians)
        .set({ userId: account.userId, updatedAt: new Date() })
        .where(eq(guardians.id, guardianId));
      await audit(tx, request, {
        action: "guardian.portal_access",
        entityType: "guardian",
        entityId: guardianId,
        data: { userId: account.userId, linkedExisting: account.linkedExisting, ...extra },
      });
    });
  }

  // ── Acceso al portal (oficina) ──
  app.post("/guardians/:id/portal-access", office, async (request): Promise<PortalAccessDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(portalAccessInputSchema, request.body ?? {});
    let guardian = await guardianOrThrow(db, schoolId, id);
    const nationalId = input.nationalId ?? guardian.nationalId ?? undefined;
    const email = input.email ?? guardian.email ?? undefined;
    if (!nationalId && !email) {
      throw badRequest("Para darle acceso, escribe el número de identidad o el correo del encargado", {
        fields: [{ path: "nationalId", message: "Escribe la identidad o el correo" }],
      });
    }
    // Lo que se escribe aquí queda también en la ficha del encargado.
    if ((input.nationalId && !guardian.nationalId) || (input.email && !guardian.email)) {
      try {
        const [updated] = await db
          .update(guardians)
          .set({ nationalId: nationalId ?? null, email: email ?? null, updatedAt: new Date() })
          .where(eq(guardians.id, guardian.id))
          .returning();
        if (updated) guardian = updated;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("Ya hay otro encargado con esa identidad en el centro");
        throw err;
      }
    }
    const account = await identity.createFamilyAccount(bearerOf(request), {
      name: guardian.fullName,
      nationalId,
      email,
    });
    await linkAccount(request, guardian.id, account);
    return accessDto(guardian, account);
  });

  /**
   * Acceso al portal para las familias de toda una sección de una vez (por ejemplo, para entregar las
   * cartas en la reunión de padres): al responsable principal de cada alumno activo, o a todos sus
   * encargados. Un encargado con varios hijos en la sección recibe una sola cuenta. Los que no se
   * pueden (sin identidad ni correo en su ficha) se informan para completarlos.
   */
  app.post("/sections/:id/portal-access", office, async (request): Promise<SectionFamilyAccessDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { allGuardians } = parseOrThrow(sectionFamilyAccessInputSchema, request.body ?? {});
    const section = await getSection(db, schoolId, id);
    const rows = await db
      .select({
        studentId: students.id,
        firstNames: students.firstNames,
        lastNames: students.lastNames,
        guardian: guardians,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .leftJoin(
        studentGuardians,
        and(
          eq(studentGuardians.studentId, students.id),
          allGuardians ? undefined : eq(studentGuardians.isPrimary, true),
        ),
      )
      .leftJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(
        and(
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.sectionId, section.id),
          eq(enrollments.status, "activa"),
        ),
      )
      .orderBy(asc(students.lastNames), asc(students.firstNames), desc(studentGuardians.isPrimary));

    const result: SectionFamilyAccessDto = { created: [], alreadyActive: 0, skipped: [], interrupted: null };
    const seen = new Set<string>();
    for (const row of rows) {
      const studentName = `${row.firstNames} ${row.lastNames}`;
      const guardian = row.guardian;
      if (!guardian) {
        result.skipped.push({
          studentId: row.studentId,
          studentName,
          guardianName: null,
          reason: "No tiene responsable registrado",
        });
        continue;
      }
      if (seen.has(guardian.id)) continue;
      seen.add(guardian.id);
      if (guardian.userId) {
        result.alreadyActive++;
        continue;
      }
      const skip = (reason: string) =>
        result.skipped.push({
          studentId: row.studentId,
          studentName,
          guardianName: guardian.fullName,
          reason,
        });
      if (!guardian.nationalId && !guardian.email) {
        skip("Sin identidad ni correo en su ficha");
        continue;
      }
      let account: FamilyAccountDto;
      try {
        account = await identity.createFamilyAccount(bearerOf(request), {
          name: guardian.fullName,
          nationalId: guardian.nationalId ?? undefined,
          email: guardian.email ?? undefined,
        });
      } catch (err) {
        if (err instanceof ApiError && err.statusCode < 500) {
          skip(err.message);
          continue;
        }
        // Lo creado hasta aquí ya quedó: se devuelve para no perder sus contraseñas temporales.
        result.interrupted =
          err instanceof ApiError ? err.message : "Se cortó la conexión. Vuelve a intentarlo.";
        break;
      }
      await linkAccount(request, guardian.id, account, { sectionId: section.id });
      result.created.push(await accessDto(guardian, account));
    }
    return result;
  });

  app.post("/guardians/:id/portal-access/reset", office, async (request): Promise<PortalAccessDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const guardian = await guardianOrThrow(db, schoolId, id);
    if (!guardian.userId) throw badRequest("Este encargado todavía no tiene acceso al portal");
    const account = await identity.resetFamilyPassword(bearerOf(request), guardian.userId);
    await audit(db, request, { action: "guardian.portal_reset", entityType: "guardian", entityId: id });
    return accessDto(guardian, account);
  });

  app.delete("/guardians/:id/portal-access", office, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const guardian = await guardianOrThrow(db, schoolId, id);
    if (guardian.userId) {
      // Si la misma cuenta quedó en otra ficha de este centro, no se le quita el acceso del todo.
      const [other] = await db
        .select({ id: guardians.id })
        .from(guardians)
        .where(
          and(eq(guardians.schoolId, schoolId), eq(guardians.userId, guardian.userId), ne(guardians.id, id)),
        );
      if (!other) await identity.revokeFamilyAccount(bearerOf(request), guardian.userId);
      await db.transaction(async (tx) => {
        await tx.update(guardians).set({ userId: null, updatedAt: new Date() }).where(eq(guardians.id, id));
        await audit(tx, request, { action: "guardian.portal_revoked", entityType: "guardian", entityId: id });
      });
    }
    return reply.status(204).send();
  });

  /** Boleta de un alumno para imprimir desde la oficina (lo mismo que ve su familia). */
  app.get("/students/:id/report-card", staff, async (request): Promise<FamilyChildDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return familyChild(db, tenantOf(request), id, today());
  });

  // ── Portal de la familia ──
  async function ownChild(request: FastifyRequest, studentId: string) {
    const schoolId = tenantOf(request);
    const mine = await childrenOf(db, schoolId, request.auth.userId);
    // Lo de otro alumno se responde igual que si no existiera.
    if (!mine.includes(studentId)) throw notFound("Alumno no encontrado");
    return familyChild(db, schoolId, studentId, today());
  }

  app.get("/family/children", family, async (request): Promise<FamilyChildSummaryDto[]> => {
    const schoolId = tenantOf(request);
    const ids = await childrenOf(db, schoolId, request.auth.userId);
    const result: FamilyChildSummaryDto[] = [];
    for (const studentId of ids)
      result.push(summarize(await familyChild(db, schoolId, studentId, today()), today()));
    return result;
  });

  app.get("/family/children/:id", family, async (request): Promise<FamilyChildDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return ownChild(request, id);
  });
}
