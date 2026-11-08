import { badRequest, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import { createUserInputSchema, SCHOOL_ROLES, type UserDto } from "@escolar/shared";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "../db/schema";
import type { IdentityDeps } from "../deps";
import { audit } from "../lib/audit";
import { insertUser, toUserDto } from "../lib/users";

const idParams = z.object({ id: z.uuid() });
const statusBody = z.object({ active: z.boolean() });
const listQuery = z.object({ role: z.enum(SCHOOL_ROLES).optional() });

/**
 * Usuarios del colegio. Todas las consultas filtran por el colegio del token (`tenantOf`):
 * un administrador nunca ve ni toca usuarios de otro colegio, aunque conozca sus ids.
 */
export async function userRoutes(app: FastifyInstance, { db, tokens }: IdentityDeps) {
  const guard = { preHandler: [app.authenticate, requireRole("admin")] };
  // Lectura: coordinación y secretaría necesitan ver al personal (p. ej. asignar docentes a materias).
  const readGuard = { preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria")] };

  app.get("/users", readGuard, async (request): Promise<UserDto[]> => {
    const schoolId = tenantOf(request);
    const { role } = parseOrThrow(listQuery, request.query);
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.schoolId, schoolId), role ? eq(users.role, role) : undefined))
      .orderBy(asc(users.name));
    return rows.map(toUserDto);
  });

  /** Lo usan otros servicios (con el token del usuario) para validar que un id es de su colegio. */
  app.get("/users/:id", readGuard, async (request): Promise<UserDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.schoolId, schoolId)));
    if (!user) throw notFound("Usuario no encontrado");
    return toUserDto(user);
  });

  app.post("/users", guard, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(createUserInputSchema, request.body);
    const user = await db.transaction(async (tx) => {
      const created = await insertUser(tx, { ...input, schoolId });
      await audit(tx, request, {
        action: "user.created",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: created.id,
        data: { role: created.role, email: created.email },
      });
      return created;
    });
    return reply.status(201).send(toUserDto(user));
  });

  app.post("/users/:id/status", guard, async (request): Promise<UserDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { active } = parseOrThrow(statusBody, request.body);
    if (id === request.auth.userId && !active) {
      throw badRequest("No puedes desactivar tu propia cuenta");
    }
    return db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set({ active, updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.schoolId, schoolId)))
        .returning();
      if (!user) throw notFound("Usuario no encontrado");
      if (!active) await tokens.revokeAllForUser(tx, user.id);
      await audit(tx, request, {
        action: active ? "user.activated" : "user.deactivated",
        schoolId,
        actorUserId: request.auth.userId,
        entityType: "user",
        entityId: user.id,
      });
      return toUserDto(user);
    });
  });
}
