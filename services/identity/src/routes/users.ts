import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  type CreatedUserDto,
  createUserInputSchema,
  ROLE_LABELS,
  roleChangeSchema,
  SCHOOL_ROLES,
  type UserDto,
} from "@escolar/shared";
import { and, asc, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { memberships, users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { grantAccess, membershipsInSchool, toUserDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });
const statusBody = z.object({ active: z.boolean() });
const listQuery = z.object({ role: z.enum(SCHOOL_ROLES).optional() });

/**
 * Personal y familias del centro. Todas las consultas filtran por el centro de la sesión
 * (`tenantOf`): la dirección nunca ve ni toca accesos de otro centro, aunque conozca los ids.
 * Desactivar a alguien aquí le quita el acceso a ESTE centro; si trabaja en otro, lo conserva.
 */
export async function userRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = { preHandler: [app.authenticate, requireRole("admin")] };
  // Lectura: coordinación y secretaría necesitan ver al personal (p. ej. asignar docentes a materias).
  const readGuard = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };

  app.get("/users", readGuard, async (request): Promise<UserDto[]> => {
    const schoolId = tenantOf(request);
    const { role } = parseOrThrow(listQuery, request.query);
    const rows = await db
      .select({ user: users, membership: memberships })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      // Las familias no son personal: solo aparecen si se piden (?role=padre).
      .where(
        and(
          eq(memberships.schoolId, schoolId),
          role ? eq(memberships.role, role) : ne(memberships.role, "padre"),
        ),
      )
      .orderBy(asc(users.name), asc(memberships.role));
    return rows.map((r) => toUserDto(r.user, r.membership));
  });

  /**
   * Lo usan otros servicios (con el token de quien pregunta) para validar que una persona es de su
   * centro. `roles` trae todos sus roles en el centro (alguien puede ser docente y coordinador).
   */
  app.get("/users/:id", readGuard, async (request): Promise<UserDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    const own = user ? await membershipsInSchool(db, user.id, schoolId) : [];
    const first = own[0];
    if (!user || !first) throw notFound("Usuario no encontrado");
    const active = own.filter((m) => m.active);
    return { ...toUserDto(user, active[0] ?? first), roles: active.map((m) => m.role) };
  });

  app.post("/users", guard, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(createUserInputSchema, request.body);
    const result = await db.transaction(async (tx) => {
      const granted = await grantAccess(tx, { ...input, schoolId });
      await audit(tx, request, {
        action: granted.linkedExisting ? "membership.created" : "user.created",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: granted.user.id,
        data: { role: input.role, email: granted.user.email },
      });
      return granted;
    });
    const body: CreatedUserDto = {
      ...toUserDto(result.user, result.membership),
      linkedExisting: result.linkedExisting,
      temporaryPassword: result.temporaryPassword,
    };
    return reply.status(201).send(body);
  });

  app.post("/users/:id/status", guard, async (request): Promise<UserDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { active } = parseOrThrow(statusBody, request.body);
    if (id === request.auth.userId && !active) {
      throw badRequest("No puedes desactivar tu propia cuenta");
    }
    return db.transaction(async (tx) => {
      const updated = await tx
        .update(memberships)
        .set({ active, updatedAt: new Date() })
        .where(and(eq(memberships.userId, id), eq(memberships.schoolId, schoolId)))
        .returning();
      const [user] = await tx.select().from(users).where(eq(users.id, id));
      const first = updated[0];
      if (!first || !user) throw notFound("Usuario no encontrado");
      if (!active) {
        for (const m of updated) await tokens.revokeForMembership(tx, m.id);
      }
      await audit(tx, request, {
        action: active ? "user.activated" : "user.deactivated",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: id,
      });
      return toUserDto(user, first);
    });
  });

  /**
   * Cambiar el cargo de alguien en este centro (por ejemplo, de docente a coordinación). Se cambia un
   * acceso a la vez: quien tiene dos cargos conserva el otro. Sus sesiones de ese acceso se cierran
   * para que el cargo nuevo valga desde su próximo ingreso.
   */
  app.put("/users/:id/role", guard, async (request): Promise<UserDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { from, to } = parseOrThrow(roleChangeSchema, request.body);
    if (from === to) throw badRequest("Elige un cargo distinto al actual");
    if (id === request.auth.userId && from === "admin") {
      throw forbidden("No puedes quitarte la dirección a ti mismo: pídeselo a la departamental");
    }
    return db.transaction(async (tx) => {
      const own = await membershipsInSchool(tx, id, schoolId);
      const current = own.find((m) => m.role === from);
      const [user] = await tx.select().from(users).where(eq(users.id, id));
      if (!current || !user) throw notFound("Usuario no encontrado");
      if (own.some((m) => m.role === to)) {
        throw conflict(`${user.name} ya tiene el cargo ${ROLE_LABELS[to]} en este centro`);
      }
      const [updated] = await tx
        .update(memberships)
        .set({ role: to, updatedAt: new Date() })
        .where(eq(memberships.id, current.id))
        .returning();
      await tokens.revokeForMembership(tx, current.id);
      await audit(tx, request, {
        action: "membership.role_changed",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: id,
        data: { from, to },
      });
      return toUserDto(user, updated ?? current);
    });
  });
}
