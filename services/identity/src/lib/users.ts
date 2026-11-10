import { badRequest, conflict, isUniqueViolation } from "@escolar/service-kit";
import type { Role, SchoolDto, UserDto } from "@escolar/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { type Membership, memberships, type School, type User, users } from "../db/schema";
import { hashPassword, temporaryPassword } from "./passwords";

/** La persona vista desde un acceso concreto (su rol y centro en esa sesión o ese listado). */
export function toUserDto(user: User, membership: Membership): UserDto {
  return {
    id: user.id,
    schoolId: membership.schoolId,
    name: user.name,
    email: user.email,
    nationalId: user.nationalId,
    mustChangePassword: user.mustChangePassword,
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
  email?: string | null;
  nationalId?: string | null;
  /** Sin contraseña: se genera una temporal que hay que cambiar al entrar. */
  password?: string;
  role: Role;
  schoolId?: string | null;
  districtId?: string | null;
  departmentId?: string | null;
}

export interface Provisioned {
  user: User;
  membership: Membership;
  /** La persona ya tenía cuenta en la plataforma: no se tocó su contraseña. */
  linkedExisting: boolean;
  /** Ya tenía exactamente este acceso (activo). */
  alreadyHadAccess: boolean;
  /** Solo para cuentas nuevas sin contraseña elegida. */
  temporaryPassword: string | null;
}

/** La cuenta de una persona por su identidad o su correo (conflicto si son de personas distintas). */
export async function findAccount(
  db: DbOrTx,
  ids: { email?: string | null; nationalId?: string | null },
): Promise<User | undefined> {
  const [byNationalId] = ids.nationalId
    ? await db.select().from(users).where(eq(users.nationalId, ids.nationalId))
    : [];
  const [byEmail] = ids.email
    ? await db.select().from(users).where(eq(users.email, ids.email.trim().toLowerCase()))
    : [];
  if (byNationalId && byEmail && byNationalId.id !== byEmail.id) {
    throw conflict("Esa identidad y ese correo pertenecen a personas distintas");
  }
  return byNationalId ?? byEmail;
}

const sameScope = (input: AccountInput) =>
  and(
    input.schoolId ? eq(memberships.schoolId, input.schoolId) : isNull(memberships.schoolId),
    input.districtId ? eq(memberships.districtId, input.districtId) : isNull(memberships.districtId),
    input.departmentId ? eq(memberships.departmentId, input.departmentId) : isNull(memberships.departmentId),
  );

/**
 * Crea la cuenta (o encuentra la que ya tiene la persona) y le da el acceso pedido. Si ya tenía cuenta
 * no se toca su contraseña; si ya tenía ese acceso desactivado, se reactiva.
 */
export async function provisionAccount(db: DbOrTx, input: AccountInput): Promise<Provisioned> {
  const email = input.email ? input.email.trim().toLowerCase() : null;
  const nationalId = input.nationalId ?? null;
  if (!email && !nationalId) throw badRequest("Hace falta el correo o el número de identidad");
  let user = await findAccount(db, { email, nationalId });
  const linkedExisting = Boolean(user);
  let temporary: string | null = null;

  if (!user) {
    const password = input.password ?? temporaryPassword();
    if (!input.password) temporary = password;
    try {
      [user] = await db
        .insert(users)
        .values({
          name: input.name,
          email,
          nationalId,
          passwordHash: await hashPassword(password),
          mustChangePassword: !input.password,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Ya existe una cuenta con ese correo o esa identidad");
      throw err;
    }
  } else if ((nationalId && !user.nationalId) || (email && !user.email)) {
    // Se completa el dato que le faltaba (p. ej. tenía correo y ahora también entra con su identidad).
    [user] = await db
      .update(users)
      .set({ nationalId: user.nationalId ?? nationalId, email: user.email ?? email, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
  }
  if (!user) throw new Error("No se pudo crear la cuenta");

  const [existing] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, input.role), sameScope(input)));
  let membership = existing;
  if (!existing) {
    [membership] = await db
      .insert(memberships)
      .values({
        userId: user.id,
        role: input.role,
        schoolId: input.schoolId ?? null,
        districtId: input.districtId ?? null,
        departmentId: input.departmentId ?? null,
      })
      .returning();
  } else if (!existing.active) {
    [membership] = await db
      .update(memberships)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(memberships.id, existing.id))
      .returning();
  }
  if (!membership) throw new Error("No se pudo crear el acceso");
  if (!user.lastMembershipId) {
    await db.update(users).set({ lastMembershipId: membership.id }).where(eq(users.id, user.id));
  }
  return {
    user,
    membership,
    linkedExisting,
    alreadyHadAccess: Boolean(existing?.active),
    temporaryPassword: temporary,
  };
}

/** Como provisionAccount, pero es un error si la persona ya tenía ese acceso. */
export async function grantAccess(
  db: DbOrTx,
  input: AccountInput,
): Promise<{
  user: User;
  membership: Membership;
  linkedExisting: boolean;
  temporaryPassword: string | null;
}> {
  const result = await provisionAccount(db, input);
  if (result.alreadyHadAccess) throw conflict(`${result.user.name} ya tiene ese acceso`);
  return result;
}

/** Accesos de la persona en un centro (normalmente uno; puede tener más de un rol en el mismo centro). */
export async function membershipsInSchool(db: DbOrTx, userId: string, schoolId: string) {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId)));
}
