import { isUniqueViolation } from "@escolar/service-kit";
import { type Role, STAFF_ROLES } from "@escolar/shared";
import { and, asc, eq, inArray, isNotNull, isNull, like } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { memberships, type User, users } from "../db/schema";

/**
 * Usuario automático del personal del centro: inicial del nombre + primer apellido («Lucía Paz Mejía»
 * → «lpaz»). Si ya existe, se agrega la inicial del segundo apellido («lpazm»), después el segundo
 * apellido completo («lpazmejia») y, si aun así se repite, un número («lpaz2»). Único en toda la
 * plataforma: con él se entra, igual que con el correo o la identidad.
 */

/** Partículas que no cuentan como apellido («de la Cruz» → «cruz»). */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "van", "von", "da", "do", "dos"]);

/** Minúsculas, sin tildes ni eñes, solo letras. */
export const plain = (word: string) =>
  word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const words = (text: string) =>
  text
    .split(/\s+/)
    .map(plain)
    .filter((w) => w && !PARTICLES.has(w));

/**
 * Nombre y apellidos. Si vienen por separado se usan tal cual; si solo hay un nombre completo se
 * supone el orden hondureño: nombre(s) y luego dos apellidos.
 */
export function nameParts(input: { name: string; firstNames?: string | null; lastNames?: string | null }) {
  if (input.firstNames?.trim() && input.lastNames?.trim()) {
    const first = words(input.firstNames)[0] ?? "";
    const [last1 = "", last2 = ""] = words(input.lastNames);
    return { first, last1, last2 };
  }
  const all = words(input.name);
  if (all.length >= 4) return { first: all[0] ?? "", last1: all.at(-2) ?? "", last2: all.at(-1) ?? "" };
  if (all.length === 3) return { first: all[0] ?? "", last1: all[1] ?? "", last2: all[2] ?? "" };
  return { first: all[0] ?? "", last1: all[1] ?? "", last2: "" };
}

/** Los usuarios que se prueban, en orden. */
export function usernameCandidates(parts: { first: string; last1: string; last2: string }): string[] {
  const { first, last1, last2 } = parts;
  const base = last1 ? `${first.slice(0, 1)}${last1}` : first || "usuario";
  const list = [base];
  if (last2) list.push(`${base}${last2.slice(0, 1)}`, `${base}${last2}`);
  for (let n = 2; n <= 99; n++) list.push(`${base}${n}`);
  return [...new Set(list.map((u) => u.slice(0, 40)))];
}

/** Elige el primer usuario libre (se consulta de una vez todo lo que empieza igual). */
export async function freeUsername(db: DbOrTx, candidates: string[]): Promise<string> {
  const base = candidates[0] ?? "usuario";
  const taken = new Set(
    (
      await db
        .select({ u: users.username })
        .from(users)
        .where(like(users.username, `${base}%`))
    ).map((r) => r.u),
  );
  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;
  // Más de 99 personas con el mismo nombre de usuario base: número al azar.
  return `${base}${Math.floor(100 + Math.random() * 9900)}`;
}

export const isStaffRole = (role: Role) => (STAFF_ROLES as readonly string[]).includes(role);

/**
 * Le pone usuario a la persona si todavía no tiene. Si otra persona tomó el mismo al mismo tiempo,
 * se vuelve a intentar con el siguiente libre.
 */
export async function ensureUsername(
  db: DbOrTx,
  user: User,
  names: { firstNames?: string | null; lastNames?: string | null } = {},
): Promise<User> {
  if (user.username) return user;
  const candidates = usernameCandidates(nameParts({ name: user.name, ...names }));
  for (let attempt = 0; attempt < 3; attempt++) {
    const username = await freeUsername(db, candidates);
    try {
      const [updated] = await db
        .update(users)
        .set({ username, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      if (updated) return updated;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("No se pudo asignar un usuario");
}

/**
 * Personal que ya tenía cuenta antes de los usuarios automáticos: se le asigna el suyo. Se corre al
 * arrancar identity (no hace nada si ya todos tienen). Los más antiguos eligen primero.
 */
export async function assignMissingStaffUsernames(db: DbOrTx): Promise<number> {
  const pending = await db
    .selectDistinct({ user: users })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        isNull(users.username),
        isNull(users.deletedAt),
        isNotNull(memberships.schoolId),
        inArray(memberships.role, [...STAFF_ROLES]),
      ),
    )
    .orderBy(asc(users.createdAt));
  for (const { user } of pending) await ensureUsername(db, user);
  return pending.length;
}
