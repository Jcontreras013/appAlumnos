import {
  type FinalStudentDto,
  finalResult,
  type PromotionDecision,
  periodGrade,
  type SectionFinalsDto,
} from "@escolar/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { activities, recoveryGrades, scores } from "../db/schema";
import { listPeriods, passingGradeOf, rosterOf } from "./evaluation";
import { getSection, listAssignments } from "./queries";

/**
 * Notas finales de una sección: para cada alumno y materia, la nota de cada parcial, el promedio, la
 * recuperación y el resultado; y lo que se propone para el año siguiente.
 */
export async function sectionFinals(
  db: DbOrTx,
  schoolId: string,
  sectionId: string,
): Promise<SectionFinalsDto> {
  const section = await getSection(db, schoolId, sectionId);
  const [periods, passingGrade, roster] = await Promise.all([
    listPeriods(db, schoolId, section.schoolYearId),
    passingGradeOf(db, schoolId),
    rosterOf(db, schoolId, [sectionId]),
  ]);
  const classes = (await listAssignments(db, schoolId, { schoolYearId: section.schoolYearId }))
    .filter((a) => a.sectionId === sectionId)
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "es"));
  const ids = classes.map((c) => c.id);
  const acts = ids.length
    ? await db
        .select({
          id: activities.id,
          assignmentId: activities.assignmentId,
          periodId: activities.periodId,
          maxPoints: activities.maxPoints,
        })
        .from(activities)
        .where(and(eq(activities.schoolId, schoolId), inArray(activities.assignmentId, ids)))
    : [];
  const [marks, recoveries] = await Promise.all([
    acts.length
      ? db
          .select({ activityId: scores.activityId, studentId: scores.studentId, points: scores.points })
          .from(scores)
          .where(
            and(
              eq(scores.schoolId, schoolId),
              inArray(
                scores.activityId,
                acts.map((a) => a.id),
              ),
            ),
          )
      : Promise.resolve([]),
    ids.length
      ? db
          .select()
          .from(recoveryGrades)
          .where(and(eq(recoveryGrades.schoolId, schoolId), inArray(recoveryGrades.assignmentId, ids)))
      : Promise.resolve([]),
  ]);
  const pointsOf = new Map(marks.map((m) => [`${m.activityId}:${m.studentId}`, m.points]));
  const recoveryOf = new Map(recoveries.map((r) => [`${r.assignmentId}:${r.studentId}`, r.score]));

  const students: FinalStudentDto[] = roster.map((kid) => {
    const subjects = classes.map((c) => {
      const byPeriod = periods.map((p) => {
        const list = acts.filter((a) => a.assignmentId === c.id && a.periodId === p.id);
        return periodGrade(
          list,
          Object.fromEntries(list.map((a) => [a.id, pointsOf.get(`${a.id}:${kid.studentId}`)])),
        ).grade;
      });
      const recovery = recoveryOf.get(`${c.id}:${kid.studentId}`) ?? null;
      const result = finalResult(byPeriod, recovery, passingGrade);
      return {
        assignmentId: c.id,
        subjectName: c.subjectName,
        periods: byPeriod,
        recovery,
        ...result,
      };
    });
    const proposal: PromotionDecision = subjects.some((s) => s.status === "incompleta")
      ? "pendiente"
      : subjects.some((s) => s.status === "reprobada")
        ? "repite"
        : "promovido";
    return {
      studentId: kid.studentId,
      name: `${kid.lastNames}, ${kid.firstNames}`,
      nationalId: kid.nationalId,
      subjects,
      proposal,
    };
  });

  return {
    sectionId,
    sectionLabel: section.label,
    gradeName: section.gradeName,
    passingGrade,
    periods: periods.map((p) => p.name),
    students,
  };
}
