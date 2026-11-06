import { conflict, isUniqueViolation } from "@escolar/service-kit";
import type { Role, SchoolDto, UserDto } from "@escolar/shared";
import type { DbOrTx } from "../db/client";
import { type School, type User, users } from "../db/schema";
import { hashPassword } from "./passwords";

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    schoolId: user.schoolId,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSchoolDto(school: School): SchoolDto {
  return {
    id: school.id,
    slug: school.slug,
    name: school.name,
    rtn: school.rtn,
    active: school.active,
    createdAt: school.createdAt.toISOString(),
  };
}

export async function insertUser(
  db: DbOrTx,
  input: { schoolId: string | null; name: string; email: string; password: string; role: Role },
): Promise<User> {
  try {
    const [user] = await db
      .insert(users)
      .values({
        schoolId: input.schoolId,
        name: input.name,
        email: input.email.trim().toLowerCase(),
        passwordHash: await hashPassword(input.password),
        role: input.role,
      })
      .returning();
    if (!user) throw new Error("No se pudo crear el usuario");
    return user;
  } catch (err) {
    if (isUniqueViolation(err, "users_email_unique")) {
      throw conflict("Ya existe un usuario con ese correo electrónico");
    }
    throw err;
  }
}
