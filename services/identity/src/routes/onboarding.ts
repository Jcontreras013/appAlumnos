import { ApiError, badRequest, forbidden, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type AccountImportStatus,
  type ImportSummaryDto,
  type SchoolImportRowDto,
  type StaffImportRowDto,
  schoolImportInputSchema,
  staffImportInputSchema,
  staffRoleFrom,
} from "@escolar/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { DbOrTx } from "../db/client";
import { districts, memberships, schools } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { comparable, identifiersOf, loginLabel, nameOf, slugify } from "../lib/imports";
import { findAccount, provisionAccount } from "../lib/users";

const HAS_ERRORS = "El archivo tiene errores: revisa la vista previa";

/** ¿La persona ya tiene una cuenta? (o un error si identidad y correo son de personas distintas) */
async function lookup(db: DbOrTx, ids: { nationalId?: string; email?: string }) {
  try {
    return { user: await findAccount(db, ids), error: undefined };
  } catch (err) {
    return { user: undefined, error: err instanceof Error ? err.message : "Datos inconsistentes" };
  }
}

function summary<R extends { status: AccountImportStatus; temporaryPassword: string | null }>(
  dryRun: boolean,
  rows: R[],
): ImportSummaryDto<R> {
  const invalid = rows.filter((r) => r.status === "error").length;
  return {
    dryRun,
    rows,
    valid: rows.length - invalid,
    invalid,
    created: rows.filter((r) => r.temporaryPassword).length,
  };
}

/**
 * Puesta en marcha: carga del personal de un centro y de los centros de un departamento desde un
 * Excel. Primero se valida todo (vista previa); al confirmar se crea todo en una transacción o nada.
 */
export async function onboardingRoutes(app: FastifyInstance, { db }: IdentityDeps) {
  // ── Personal de un centro (la dirección) ──
  app.post(
    "/users/import",
    { preHandler: [app.authenticate, requireRole("admin")] },
    async (request): Promise<ImportSummaryDto<StaffImportRowDto>> => {
      const schoolId = tenantOf(request);
      const { rows: raw, dryRun } = parseOrThrow(staffImportInputSchema, request.body);
      const seen = new Map<string, number>();
      const rows: Array<StaffImportRowDto & { ids: { nationalId?: string; email?: string } }> = [];

      for (const [i, cells] of raw.entries()) {
        const row = i + 2; // la fila 1 son los encabezados
        const { name, error: nameError } = nameOf(cells.nombre, "Falta el nombre completo");
        const ids = identifiersOf(cells.identidad, cells.correo);
        const role = staffRoleFrom(cells.rol);
        const errors = [...(nameError ? [nameError] : []), ...ids.errors];
        if (!role)
          errors.push(`Cargo desconocido "${cells.rol}": usa docente, coordinador, secretaria o finanzas`);
        for (const key of [ids.nationalId, ids.email]) {
          if (!key) continue;
          const first = seen.get(key);
          if (first) errors.push(`Repetido con la fila ${first}`);
          else seen.set(key, row);
        }
        let status: AccountImportStatus = "error";
        if (errors.length === 0) {
          const found = await lookup(db, ids);
          if (found.error) errors.push(found.error);
          else if (!found.user) status = "nuevo";
          else {
            const [has] = await db
              .select({ id: memberships.id })
              .from(memberships)
              .where(
                and(
                  eq(memberships.userId, found.user.id),
                  eq(memberships.schoolId, schoolId),
                  eq(memberships.role, role ?? "docente"),
                  eq(memberships.active, true),
                ),
              );
            status = has ? "ya_tiene_acceso" : "existente";
          }
        }
        rows.push({
          row,
          name,
          login: loginLabel(ids),
          role,
          status: errors.length ? "error" : status,
          errors,
          temporaryPassword: null,
          ids: { nationalId: ids.nationalId, email: ids.email },
        });
      }

      const clean = () => rows.map(({ ids: _ids, ...r }) => r);
      if (dryRun) return summary(true, clean());
      if (rows.some((r) => r.status === "error"))
        throw new ApiError(409, "import_has_errors", HAS_ERRORS, summary(false, clean()));

      await db.transaction(async (tx) => {
        for (const r of rows) {
          if (r.status === "ya_tiene_acceso" || !r.role) continue;
          const result = await provisionAccount(tx, { name: r.name, ...r.ids, role: r.role, schoolId });
          r.temporaryPassword = result.temporaryPassword;
        }
        await audit(tx, request, {
          action: "users.imported",
          schoolId,
          actorUserId: request.auth.userId,
          data: { rows: rows.length },
        });
      });
      return summary(false, clean());
    },
  );

  // ── Centros de un departamento, cada uno con su director (la departamental) ──
  app.post(
    "/scope/schools/import",
    { preHandler: [app.authenticate, requireRole("director_departamental", "superadmin")] },
    async (request): Promise<ImportSummaryDto<SchoolImportRowDto>> => {
      const input = parseOrThrow(schoolImportInputSchema, request.body);
      const departmentId =
        request.auth.role === "superadmin" ? input.departmentId : (request.auth.departmentId ?? undefined);
      if (!departmentId) {
        throw request.auth.role === "superadmin"
          ? badRequest("Elige el departamento")
          : forbidden("Tu cuenta no tiene un departamento asignado");
      }
      const own = await db.select().from(districts).where(eq(districts.departmentId, departmentId));
      if (own.length === 0) throw badRequest("El departamento no tiene distritos todavía");
      const districtByName = new Map(own.map((d) => [comparable(d.name), d]));

      const codes = input.rows.map((r) => (r.codigo ?? "").trim()).filter(Boolean);
      const takenCodes = new Set(
        codes.length
          ? (await db.select({ code: schools.code }).from(schools).where(inArray(schools.code, codes))).map(
              (s) => s.code,
            )
          : [],
      );
      const takenSlugs = new Set((await db.select({ slug: schools.slug }).from(schools)).map((s) => s.slug));
      const seenCodes = new Map<string, number>();

      type Planned = SchoolImportRowDto & {
        slug: string;
        districtId: string;
        ids: { nationalId?: string; email?: string };
      };
      const rows: Planned[] = [];
      for (const [i, cells] of input.rows.entries()) {
        const row = i + 2;
        const errors: string[] = [];
        const schoolName = (cells.centro ?? "").trim();
        if (schoolName.length < 3) errors.push("Falta el nombre del centro");
        const code = (cells.codigo ?? "").trim() || null;
        if (code) {
          if (takenCodes.has(code)) errors.push(`Ya hay un centro con el código ${code}`);
          const first = seenCodes.get(code);
          if (first) errors.push(`Código repetido con la fila ${first}`);
          else seenCodes.set(code, row);
        }
        const district = districtByName.get(comparable(cells.distrito ?? ""));
        if (!district) {
          errors.push(
            `Distrito desconocido "${cells.distrito ?? ""}": usa ${own.map((d) => d.name).join(", ")}`,
          );
        }
        const director = nameOf(cells.director, "Falta el nombre del director o directora");
        if (director.error) errors.push(director.error);
        const ids = identifiersOf(cells.identidad_director, cells.correo_director);
        errors.push(...ids.errors);
        const found = errors.length === 0 ? await lookup(db, ids) : { user: undefined, error: undefined };
        if (found.error) errors.push(found.error);

        let slug = slugify(schoolName);
        for (let n = 2; takenSlugs.has(slug); n++) slug = `${slugify(schoolName).slice(0, 46)}-${n}`;
        takenSlugs.add(slug);

        rows.push({
          row,
          schoolName,
          code,
          districtName: district?.name ?? (cells.distrito ?? "").trim(),
          directorName: director.name,
          directorLogin: loginLabel(ids),
          status: errors.length ? "error" : found.user ? "existente" : "nuevo",
          errors,
          temporaryPassword: null,
          slug,
          districtId: district?.id ?? "",
          ids: { nationalId: ids.nationalId, email: ids.email },
        });
      }

      const clean = () => rows.map(({ slug: _s, districtId: _d, ids: _i, ...r }) => r);
      if (input.dryRun) return summary(true, clean());
      if (rows.some((r) => r.status === "error"))
        throw new ApiError(409, "import_has_errors", HAS_ERRORS, summary(false, clean()));

      await db.transaction(async (tx) => {
        for (const r of rows) {
          const [school] = await tx
            .insert(schools)
            .values({
              name: r.schoolName,
              slug: r.slug,
              code: r.code,
              sector: "publico",
              districtId: r.districtId,
            })
            .returning();
          if (!school) throw new Error("No se pudo crear el centro");
          const director = await provisionAccount(tx, {
            name: r.directorName,
            ...r.ids,
            role: "admin",
            schoolId: school.id,
          });
          r.temporaryPassword = director.temporaryPassword;
        }
        await audit(tx, request, {
          action: "schools.imported",
          actorUserId: request.auth.userId,
          data: { departmentId, rows: rows.length },
        });
      });
      return summary(false, clean());
    },
  );
}
