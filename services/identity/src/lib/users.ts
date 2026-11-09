import { conflict, isUniqueViolation } from "@escolar/service-kit";
import type { Role, SchoolDto, UserDto } from "@escolar/shared";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { type Membership, memberships, type School, type User, users } from "../db/schema";
import { hashPassword } from "./passwords";

/** La persona vista desde un acceso concreto (su rol y centro en esa sesión o ese listado). */
export function toUserDto(user: User, membership: Membership): UserDto {
  return {
    id: user.id,
    schoolId: membership.schoolId,
    name: user.name,
    email: user.email,
    role: membership.role,
    active: user.active && membership.active,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSchoolDto(school: School): SchoolDto {
  return {
    id: school.id,
    slug: school.slug,
    name: school.name,
    rtn: school.rtn,
    code: school.code,
    sector: school.sector,
    districtId: school.districtId,
    active: school.active,
    logoVersion: school.logoUpdatedAt ? school.logoUpdatedAt.getTime() : null,
    createdAt: school.createdAt.toISOString(),
  };
}

export interface AccountInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  schoolId?: string | null;
  districtId?: string | null;
  departmentId?: string | null;
}

/**
 * Da acceso a una persona con un rol en un ámbito (centro, distrito o departamento).
 * Si el correo ya tiene cuenta (p. ej. una maestra que ya trabaja en otra escuela), no se crea otra:
 * se le agrega el acceso nuevo y conserva su contraseña. Así una persona tiene una sola cuenta.
 */
export async function grantAccess(
  db: DbOrTx,
  input: AccountInput,
): Promise<{ user: User; membership: Membership; linkedExisting: boolean }> {
  const email = input.email.trim().toLowerCase();
  let [user] = await db.select().from(users).where(eq(users.email, email));
  const linkedExisting = Boolean(user);

  if (!user) {
    try {
      [user] = await db
        .insert(users)
        .values({ name: input.name, email, passwordHash: await hashPassword(input.password) })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, "users_email_unique")) {
        throw conflict("Ya existe una cuenta con ese correo electrónico");
      }
      throw err;
    }
  }
  if (!user) throw new Error("No se pudo crear la cuenta");

  try {
    const [membership] = await db
      .insert(memberships)
      .values({
        userId: user.id,
        role: input.role,
        schoolId: input.schoolId ?? null,
        districtId: input.districtId ?? null,
        departmentId: input.departmentId ?? null,
      })
      .returning();
    if (!membership) throw new Error("No se pudo crear el acceso");
    if (!user.lastMembershipId) {
      await db.update(users).set({ lastMembershipId: membership.id }).where(eq(users.id, user.id));
    }
    return { user, membership, linkedExisting };
  } catch (err) {
    if (isUniqueViolation(err, "memberships_unique")) {
      throw conflict(`${user.name} ya tiene ese acceso`);
    }
    throw err;
  }
}

/** Accesos de la persona en un centro (normalmente uno; puede tener más de un rol en el mismo centro). */
export async function membershipsInSchool(db: DbOrTx, userId: string, schoolId: string) {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId)));
}
