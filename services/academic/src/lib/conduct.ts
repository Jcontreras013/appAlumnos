import {
  type ConductIncidentDto,
  type ConductMeasureDto,
  type ConductRecordDto,
  type RegionalConductDto,
  suspensionActive,
} from "@escolar/shared";
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { conductIncidents, conductMeasures, enrollments, students } from "../db/schema";
import { findCurrentYear, listSections } from "./queries";

type IncidentRow = typeof conductIncidents.$inferSelect;
type MeasureRow = typeof conductMeasures.$inferSelect;

const measureDto = (m: MeasureRow): ConductMeasureDto => ({
  id: m.id,
  incidentId: m.incidentId,
  kind: m.kind,
  startsOn: m.startsOn,
  endsOn: m.endsOn,
  notes: m.notes,
  decidedByName: m.decidedByName,
  createdAt: m.createdAt.toISOString(),
  cancelledAt: m.cancelledAt?.toISOString() ?? null,
  notifyFamily: m.notifyFamily,
});

/** Nombre y sección actual (año vigente) de cada alumno. */
async function studentLabels(db: DbOrTx, schoolId: string, studentIds: string[]) {
  const names = new Map<string, string>();
  const sectionOf = new Map<string, string>();
  if (studentIds.length === 0) return { names, sectionOf };
  const rows = await db
    .select({ id: students.id, firstNames: students.firstNames, lastNames: students.lastNames })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)));
  for (const r of rows) names.set(r.id, `${r.lastNames}, ${r.firstNames}`);
  const year = await findCurrentYear(db, schoolId);
  if (year) {
    const sections = new Map((await listSections(db, schoolId, year.id)).map((s) => [s.id, s.label]));
    const enrolled = await db
      .select({ studentId: enrollments.studentId, sectionId: enrollments.sectionId })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.schoolId, schoolId),
          eq(enrollments.schoolYearId, year.id),
          inArray(enrollments.studentId, studentIds),
        ),
      );
    for (const e of enrolled) {
      const label = sections.get(e.sectionId);
      if (label) sectionOf.set(e.studentId, label);
    }
  }
  return { names, sectionOf };
}

/**
 * Incidentes con sus medidas, el más reciente primero. `canDeleteFor` dice si quien consulta puede
 * borrar cada uno (solo mientras no tenga medidas).
 */
export async function listIncidents(
  db: DbOrTx,
  schoolId: string,
  filter: { studentId?: string; reportedBy?: string; from?: string; to?: string },
  canDeleteFor: (incident: IncidentRow) => boolean = () => false,
): Promise<ConductIncidentDto[]> {
  const where: SQL[] = [eq(conductIncidents.schoolId, schoolId)];
  if (filter.studentId) where.push(eq(conductIncidents.studentId, filter.studentId));
  if (filter.reportedBy) where.push(eq(conductIncidents.reportedByUserId, filter.reportedBy));
  if (filter.from) where.push(gte(conductIncidents.date, filter.from));
  if (filter.to) where.push(lte(conductIncidents.date, filter.to));
  const incidents = await db
    .select()
    .from(conductIncidents)
    .where(and(...where))
    .orderBy(desc(conductIncidents.date), desc(conductIncidents.createdAt));
  if (incidents.length === 0) return [];
  const measures = await db
    .select()
    .from(conductMeasures)
    .where(
      and(
        eq(conductMeasures.schoolId, schoolId),
        inArray(
          conductMeasures.incidentId,
          incidents.map((i) => i.id),
        ),
      ),
    )
    .orderBy(asc(conductMeasures.startsOn), asc(conductMeasures.createdAt));
  const byIncident = new Map<string, ConductMeasureDto[]>();
  for (const m of measures) {
    const list = byIncident.get(m.incidentId) ?? [];
    list.push(measureDto(m));
    byIncident.set(m.incidentId, list);
  }
  const { names, sectionOf } = await studentLabels(db, schoolId, [
    ...new Set(incidents.map((i) => i.studentId)),
  ]);
  return incidents.map((i) => {
    const own = byIncident.get(i.id) ?? [];
    return {
      id: i.id,
      studentId: i.studentId,
      studentName: names.get(i.studentId) ?? "Alumno",
      sectionLabel: sectionOf.get(i.studentId) ?? null,
      date: i.date,
      severity: i.severity,
      category: i.category,
      description: i.description,
      reportedByName: i.reportedByName,
      createdAt: i.createdAt.toISOString(),
      measures: own,
      canDelete: own.length === 0 && canDeleteFor(i),
    };
  });
}

/** Las medidas vigentes (no anuladas) como las ve la familia o la departamental: sin la descripción. */
const records = (
  incidents: ConductIncidentDto[],
): Array<ConductRecordDto & { incident: ConductIncidentDto }> =>
  incidents
    .flatMap((i) =>
      i.measures
        .filter((m) => !m.cancelledAt)
        .map((m) => ({
          measureId: m.id,
          incidentDate: i.date,
          severity: i.severity,
          category: i.category,
          kind: m.kind,
          startsOn: m.startsOn,
          endsOn: m.endsOn,
          notes: m.notes,
          incident: i,
        })),
    )
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn));

/** Rango del año lectivo vigente (o nada, si el centro no tiene año). */
async function yearRange(db: DbOrTx, schoolId: string) {
  const year = await findCurrentYear(db, schoolId);
  return year ? { from: year.startsOn, to: year.endsOn } : {};
}

/** Medidas de conducta de un alumno en el año vigente que se le avisaron a su familia. */
export async function conductRecordsFor(
  db: DbOrTx,
  schoolId: string,
  studentId: string,
): Promise<ConductRecordDto[]> {
  const incidents = await listIncidents(db, schoolId, { studentId, ...(await yearRange(db, schoolId)) });
  const told = new Set(incidents.flatMap((i) => i.measures.filter((m) => m.notifyFamily).map((m) => m.id)));
  return records(incidents)
    .filter((r) => told.has(r.measureId))
    .map(({ incident: _, ...r }) => r);
}

/** Resumen de conducta del año vigente de un centro, para la departamental. */
export async function regionalConduct(db: DbOrTx, schoolId: string): Promise<RegionalConductDto> {
  const incidents = await listIncidents(db, schoolId, await yearRange(db, schoolId));
  const all = records(incidents);
  const serious = all.filter((r) => r.kind === "suspension" || r.kind === "expulsion");
  return {
    incidents: incidents.length,
    serious: incidents.filter((i) => i.severity !== "leve").length,
    suspensions: serious.filter((r) => r.kind === "suspension").length,
    expulsions: serious.filter((r) => r.kind === "expulsion").length,
    measures: serious.map(({ incident, ...r }) => ({
      ...r,
      studentId: incident.studentId,
      studentName: incident.studentName,
      sectionLabel: incident.sectionLabel,
    })),
  };
}

/** Totales para la pantalla de Conducta. */
export function conductTotals(incidents: ConductIncidentDto[], today: string, last30From: string) {
  const measures = incidents.flatMap((i) => i.measures).filter((m) => !m.cancelledAt);
  return {
    last30Days: incidents.filter((i) => i.date >= last30From && i.date <= today).length,
    serious: incidents.filter((i) => i.severity !== "leve").length,
    activeSuspensions: measures.filter((m) => suspensionActive(m, today)).length,
    expulsions: measures.filter((m) => m.kind === "expulsion").length,
  };
}

export { yearRange };
