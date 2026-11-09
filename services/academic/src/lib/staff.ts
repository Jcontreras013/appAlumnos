import { badRequest, notFound } from "@escolar/service-kit";
import type {
  AssignmentDto,
  CoverageDto,
  CoverageRowDto,
  LeaveDto,
  SubstitutionDto,
  UserDto,
} from "@escolar/shared";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { DbOrTx } from "../db/client";
import { type Substitution, substitutions, type TeacherLeave, teacherLeaves } from "../db/schema";
import { bearerOf, type IdentityClient } from "./identity-client";
import { findCurrentYear, listAssignments } from "./queries";

const TEACHING_ROLES = ["docente", "coordinador"];

/** Valida en identity (con el token de quien pregunta) que la persona da clases en este centro. */
export async function requireTeacher(
  identity: IdentityClient,
  request: FastifyRequest,
  userId: string,
): Promise<UserDto> {
  const user = await identity.getUser(bearerOf(request), userId);
  const roles = user?.roles ?? (user ? [user.role] : []);
  if (!user?.active || !roles.some((r) => TEACHING_ROLES.includes(r))) {
    throw badRequest("El maestro no existe en este centro o no está activo");
  }
  return user;
}

export const toSubstitutionDto = (s: Substitution): SubstitutionDto => ({
  id: s.id,
  leaveId: s.leaveId,
  assignmentId: s.assignmentId,
  substituteUserId: s.substituteUserId,
  substituteName: s.substituteName,
  startsOn: s.startsOn,
  endsOn: s.endsOn,
});

/** Licencia vigente (no cancelada) del maestro que se cruce con el rango de fechas. */
export async function overlappingLeave(
  db: DbOrTx,
  schoolId: string,
  teacherUserId: string,
  startsOn: string,
  endsOn: string,
  excludeId?: string,
): Promise<TeacherLeave | null> {
  const [leave] = await db
    .select()
    .from(teacherLeaves)
    .where(
      and(
        eq(teacherLeaves.schoolId, schoolId),
        eq(teacherLeaves.teacherUserId, teacherUserId),
        isNull(teacherLeaves.cancelledAt),
        lte(teacherLeaves.startsOn, endsOn),
        gte(teacherLeaves.endsOn, startsOn),
        excludeId ? ne(teacherLeaves.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return leave ?? null;
}

/** Evita que dos personas registren a la vez licencias cruzadas del mismo maestro. */
export async function lockTeacher(tx: DbOrTx, teacherUserId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`leave:${teacherUserId}`}))`);
}

async function toLeaveDtos(db: DbOrTx, schoolId: string, leaves: TeacherLeave[]): Promise<LeaveDto[]> {
  if (leaves.length === 0) return [];
  const year = await findCurrentYear(db, schoolId);
  const assignments = year ? await listAssignments(db, schoolId, { schoolYearId: year.id }) : [];
  const subs = await db
    .select()
    .from(substitutions)
    .where(
      and(
        inArray(
          substitutions.leaveId,
          leaves.map((l) => l.id),
        ),
        isNull(substitutions.cancelledAt),
      ),
    );
  return leaves.map((leave) => ({
    id: leave.id,
    teacherUserId: leave.teacherUserId,
    teacherName: leave.teacherName,
    type: leave.type,
    startsOn: leave.startsOn,
    endsOn: leave.endsOn,
    notes: leave.notes,
    createdByName: leave.createdByName,
    cancelled: leave.cancelledAt !== null,
    createdAt: leave.createdAt.toISOString(),
    classes: assignments
      .filter((a) => a.teacherUserId === leave.teacherUserId)
      .map((assignment) => {
        const sub = subs.find((s) => s.leaveId === leave.id && s.assignmentId === assignment.id);
        return { assignment, substitution: sub ? toSubstitutionDto(sub) : null };
      }),
  }));
}

export async function getLeave(db: DbOrTx, schoolId: string, leaveId: string): Promise<LeaveDto> {
  const [leave] = await db
    .select()
    .from(teacherLeaves)
    .where(and(eq(teacherLeaves.schoolId, schoolId), eq(teacherLeaves.id, leaveId)));
  if (!leave) throw notFound("Licencia no encontrada");
  const [dto] = await toLeaveDtos(db, schoolId, [leave]);
  if (!dto) throw notFound("Licencia no encontrada");
  return dto;
}

export async function listLeaves(
  db: DbOrTx,
  schoolId: string,
  estado: "actuales" | "pasadas" | "canceladas",
  today: string,
): Promise<LeaveDto[]> {
  const filter =
    estado === "actuales"
      ? and(isNull(teacherLeaves.cancelledAt), gte(teacherLeaves.endsOn, today))
      : estado === "pasadas"
        ? and(isNull(teacherLeaves.cancelledAt), sql`${teacherLeaves.endsOn} < ${today}`)
        : sql`${teacherLeaves.cancelledAt} is not null`;
  const rows = await db
    .select()
    .from(teacherLeaves)
    .where(and(eq(teacherLeaves.schoolId, schoolId), filter))
    .orderBy(estado === "actuales" ? asc(teacherLeaves.startsOn) : desc(teacherLeaves.startsOn));
  return toLeaveDtos(db, schoolId, rows);
}

/**
 * Quién da cada clase en una fecha: su titular, un sustituto (si el titular está de licencia y
 * se le asignó uno) o nadie. "Sin maestro" es la alerta que ven la dirección y la departamental.
 */
export async function coverageFor(db: DbOrTx, schoolId: string, date: string): Promise<CoverageDto> {
  const year = await findCurrentYear(db, schoolId);
  const assignments: AssignmentDto[] = year
    ? await listAssignments(db, schoolId, { schoolYearId: year.id })
    : [];
  const activeLeaves = await db
    .select()
    .from(teacherLeaves)
    .where(
      and(
        eq(teacherLeaves.schoolId, schoolId),
        isNull(teacherLeaves.cancelledAt),
        lte(teacherLeaves.startsOn, date),
        gte(teacherLeaves.endsOn, date),
      ),
    );
  const activeSubs = activeLeaves.length
    ? await db
        .select()
        .from(substitutions)
        .where(
          and(
            inArray(
              substitutions.leaveId,
              activeLeaves.map((l) => l.id),
            ),
            isNull(substitutions.cancelledAt),
            lte(substitutions.startsOn, date),
            gte(substitutions.endsOn, date),
          ),
        )
    : [];

  const rows: CoverageRowDto[] = assignments.map((assignment) => {
    const leave = activeLeaves.find((l) => l.teacherUserId === assignment.teacherUserId);
    if (!leave) return { assignment, status: "normal", leave: null, substitute: null };
    const sub = activeSubs.find((s) => s.leaveId === leave.id && s.assignmentId === assignment.id);
    return {
      assignment,
      status: sub ? "cubierta" : "sin_cubrir",
      leave: { id: leave.id, type: leave.type, startsOn: leave.startsOn, endsOn: leave.endsOn },
      substitute: sub
        ? {
            id: sub.id,
            substituteUserId: sub.substituteUserId,
            substituteName: sub.substituteName,
            endsOn: sub.endsOn,
          }
        : null,
    };
  });
  const totals = { normal: 0, cubierta: 0, sin_cubrir: 0 };
  for (const row of rows) totals[row.status]++;
  return {
    date,
    rows,
    totals,
    teachersOnLeave: new Set(activeLeaves.map((l) => l.teacherUserId)).size,
  };
}
