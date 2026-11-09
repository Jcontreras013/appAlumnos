import type { MembershipDto } from "@escolar/shared";
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { departments, districts, type Membership, memberships, schools } from "../db/schema";

export interface ResolvedMembership {
  membership: Membership;
  dto: MembershipDto;
  /** El centro, distrito o departamento existe y está activo. */
  usable: boolean;
}

/** Completa cada acceso con el nombre de su ámbito y si se puede usar (el centro no está desactivado). */
export async function resolveMemberships(db: DbOrTx, rows: Membership[]): Promise<ResolvedMembership[]> {
  const resolved: ResolvedMembership[] = [];
  for (const membership of rows) {
    let scopeType: MembershipDto["scopeType"] = "plataforma";
    let scopeId: string | null = null;
    let scopeName = "Plataforma";
    let schoolLogoVersion: number | null = null;
    let usable = true;

    if (membership.schoolId) {
      const [school] = await db.select().from(schools).where(eq(schools.id, membership.schoolId));
      scopeType = "centro";
      scopeId = membership.schoolId;
      scopeName = school?.name ?? "Centro";
      schoolLogoVersion = school?.logoUpdatedAt ? school.logoUpdatedAt.getTime() : null;
      usable = Boolean(school?.active);
    } else if (membership.districtId) {
      const [district] = await db.select().from(districts).where(eq(districts.id, membership.districtId));
      scopeType = "distrito";
      scopeId = membership.districtId;
      scopeName = district ? `Distrito ${district.name}` : "Distrito";
    } else if (membership.departmentId) {
      const [department] = await db
        .select()
        .from(departments)
        .where(eq(departments.id, membership.departmentId));
      scopeType = "departamento";
      scopeId = membership.departmentId;
      scopeName = department ? `Departamental de ${department.name}` : "Departamento";
    }

    resolved.push({
      membership,
      usable: usable && membership.active,
      dto: {
        id: membership.id,
        role: membership.role,
        scopeType,
        scopeId,
        scopeName,
        schoolLogoVersion,
        active: membership.active,
      },
    });
  }
  return resolved;
}

/** Accesos activos y utilizables de una persona, en un orden estable. */
export async function usableMemberships(db: DbOrTx, userId: string): Promise<ResolvedMembership[]> {
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
    .orderBy(memberships.createdAt);
  return (await resolveMemberships(db, rows)).filter((r) => r.usable);
}
