import { forbidden, notFound, parseOrThrow, requireRole } from "@escolar/service-kit";
import { formatNationalId, type PasswordResetDto, type UserDto } from "@escolar/shared";
import { and, asc, eq, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { districts, memberships, schools, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { resetToTemporary, toUserDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });
const SCHOOL_STAFF_ROLES = ["docente", "coordinador", "secretaria", "finanzas", "padre"];

/** Centros sobre los que tiene autoridad quien pide (null = todos, solo el equipo de la plataforma). */
async function schoolsUnder(db: DbOrTx, request: FastifyRequest): Promise<Set<string> | null> {
  const { role, schoolId, districtId, departmentId } = request.auth;
  if (role === "superadmin") return null;
  if (role === "admin" && schoolId) return new Set([schoolId]);
  if (role === "director_distrital" && districtId) {
    const rows = await db.select({ id: schools.id }).from(schools).where(eq(schools.districtId, districtId));
    return new Set(rows.map((r) => r.id));
  }
  if (role === "director_departamental" && departmentId) {
    const rows = await db
      .select({ id: schools.id })
      .from(schools)
      .innerJoin(districts, eq(districts.id, schools.districtId))
      .where(eq(districts.departmentId, departmentId));
    return new Set(rows.map((r) => r.id));
  }
  return new Set();
}

/**
 * Contraseñas olvidadas, sin depender del correo (muchas cuentas no tienen): quien está a cargo da
 * una contraseña temporal. La dirección, a su personal; la distrital o departamental, a los centros
 * de su ámbito (incluidos los directores); el equipo de la plataforma, a cualquiera menos a sí mismo.
 */
export async function accountRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = {
    preHandler: [
      app.authenticate,
      requireRole("admin", "director_distrital", "director_departamental", "superadmin"),
    ],
  };

  app.post("/accounts/:id/reset-password", guard, async (request): Promise<PasswordResetDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    if (id === request.auth.userId) throw forbidden("Tu propia contraseña la cambias desde «Mi cuenta»");
    // Solo cuentan los accesos vigentes: si ya no trabaja en un centro, ese centro no la restablece.
    const target = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, id), eq(memberships.active, true)));
    const scope = await schoolsUnder(db, request);
    // Fuera de su ámbito, la cuenta "no existe" para quien pregunta.
    if (scope && !target.some((m) => m.schoolId && scope.has(m.schoolId)))
      throw notFound("Cuenta no encontrada");
    if (target.length === 0) throw notFound("Cuenta no encontrada");
    if (target.some((m) => m.role === "superadmin")) throw forbidden("Esta cuenta no se puede restablecer");
    if (scope) {
      if (target.some((m) => !m.schoolId || !scope.has(m.schoolId))) {
        throw forbidden(
          "Esta persona también tiene acceso fuera de tu ámbito: su contraseña la restablece la departamental o el equipo de la plataforma.",
        );
      }
      if (request.auth.role === "admin" && target.some((m) => !SCHOOL_STAFF_ROLES.includes(m.role))) {
        throw forbidden("La contraseña de otra dirección la restablece la departamental o la distrital");
      }
    }
    const { user, temporaryPassword } = await db.transaction(async (tx) => {
      const result = await resetToTemporary(tx, id);
      await tokens.revokeAllForUser(tx, id);
      await audit(tx, request, {
        action: "account.password_reset",
        schoolId: request.auth.schoolId ?? null,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: id,
      });
      return result;
    });
    return {
      userId: user.id,
      name: user.name,
      login: user.nationalId ? formatNationalId(user.nationalId) : (user.email ?? ""),
      temporaryPassword,
    };
  });

  /** Personal de un centro del ámbito (para que la departamental vea y ayude a sus directores). */
  app.get(
    "/scope/schools/:id/staff",
    {
      preHandler: [
        app.authenticate,
        requireRole("director_distrital", "director_departamental", "superadmin"),
      ],
    },
    async (request): Promise<UserDto[]> => {
      const { id } = parseOrThrow(idParams, request.params);
      const scope = await schoolsUnder(db, request);
      if (scope && !scope.has(id)) throw notFound("Centro no encontrado");
      const rows = await db
        .select({ user: users, membership: memberships })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.schoolId, id), ne(memberships.role, "padre")))
        .orderBy(asc(memberships.role), asc(users.name));
      return rows.map((r) => toUserDto(r.user, r.membership));
    },
  );
}
