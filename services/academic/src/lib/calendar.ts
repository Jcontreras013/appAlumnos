import { type DayOffDto, dayOffOn } from "@escolar/shared";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { type SchoolDayOff, schoolDaysOff } from "../db/schema";

export const toDayOffDto = (d: SchoolDayOff): DayOffDto => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  startsOn: d.startsOn,
  endsOn: d.endsOn,
});

/** Días sin clases del centro que tocan el rango [from, to] (ambos incluidos), en orden. */
export async function daysOffBetween(
  db: DbOrTx,
  schoolId: string,
  from: string,
  to: string,
): Promise<DayOffDto[]> {
  const rows = await db
    .select()
    .from(schoolDaysOff)
    .where(
      and(
        eq(schoolDaysOff.schoolId, schoolId),
        lte(schoolDaysOff.startsOn, to),
        gte(schoolDaysOff.endsOn, from),
      ),
    )
    .orderBy(asc(schoolDaysOff.startsOn));
  return rows.map(toDayOffDto);
}

/** Si ese día el centro no tiene clases, por qué. */
export async function dayOffFor(db: DbOrTx, schoolId: string, date: string): Promise<DayOffDto | null> {
  return dayOffOn(date, await daysOffBetween(db, schoolId, date, date));
}
