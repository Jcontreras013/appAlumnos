import type { ClassTaskDto, TaskFileDto, TaskStatus, TaskSubmissionDto } from "@escolar/shared";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  type ClassTask,
  gradingPeriods,
  scores,
  type TaskFile,
  type TaskSubmission,
  taskFiles,
  taskSubmissions,
} from "../db/schema";

/** Fecha y hora de Honduras (UTC-6, sin horario de verano) de un instante. */
export function hondurasParts(at: Date): { date: string; time: string } {
  const local = new Date(at.getTime() - 6 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export const toFileDto = (f: TaskFile): TaskFileDto => ({
  id: f.id,
  name: f.fileName,
  contentType: f.contentType,
  size: f.sizeBytes,
});

/** Cómo va la entrega de un alumno. */
export function statusOf(
  task: Pick<ClassTask, "dueAt" | "allowLate">,
  submission: Pick<TaskSubmission, "submittedAt" | "late"> | undefined,
  points: number | null,
  now: Date,
): TaskStatus {
  if (points !== null) return "calificada";
  if (submission?.submittedAt) return submission.late ? "tarde" : "entregada";
  const closed = now > task.dueAt && !task.allowLate;
  if (closed) return "vencida";
  return submission ? "borrador" : "pendiente";
}

/**
 * La nota de cada alumno en cada tarea. Si la tarea va a la libreta, la nota es la de la libreta (el
 * maestro también la puede cambiar desde el cuaderno); si no, la que se puso en la entrega.
 */
export async function pointsFor(
  db: DbOrTx,
  tasks: ClassTask[],
  submissions: TaskSubmission[],
): Promise<(taskId: string, studentId: string) => number | null> {
  const activityIds = tasks.map((t) => t.activityId).filter((a): a is string => a !== null);
  const rows = activityIds.length
    ? await db
        .select({ activityId: scores.activityId, studentId: scores.studentId, points: scores.points })
        .from(scores)
        .where(inArray(scores.activityId, activityIds))
    : [];
  return (taskId, studentId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task?.activityId) {
      return rows.find((r) => r.activityId === task.activityId && r.studentId === studentId)?.points ?? null;
    }
    return submissions.find((s) => s.taskId === taskId && s.studentId === studentId)?.points ?? null;
  };
}

/**
 * Las tareas de una clase listas para mostrar. Para quien da la clase, cuántos entregaron; para el
 * alumno o su familia (studentId), cómo va su entrega y su nota.
 */
export async function taskDtos(
  db: DbOrTx,
  tasks: ClassTask[],
  options: { now: Date; rosterSize?: number; studentId?: string },
): Promise<ClassTaskDto[]> {
  if (!tasks.length) return [];
  const taskIds = tasks.map((t) => t.id);
  const activityIds = tasks.map((t) => t.activityId).filter((a): a is string => a !== null);
  const [attachments, submissions, activityRows] = await Promise.all([
    db
      .select()
      .from(taskFiles)
      .where(and(inArray(taskFiles.taskId, taskIds), isNull(taskFiles.submissionId)))
      .orderBy(asc(taskFiles.createdAt)),
    db
      .select()
      .from(taskSubmissions)
      .where(
        and(
          inArray(taskSubmissions.taskId, taskIds),
          options.studentId ? eq(taskSubmissions.studentId, options.studentId) : undefined,
        ),
      ),
    activityIds.length
      ? db
          .select({
            id: activities.id,
            maxPoints: activities.maxPoints,
            periodId: activities.periodId,
            periodName: gradingPeriods.name,
          })
          .from(activities)
          .innerJoin(gradingPeriods, eq(gradingPeriods.id, activities.periodId))
          .where(inArray(activities.id, activityIds))
      : [],
  ]);
  const points = await pointsFor(db, tasks, submissions);
  return tasks.map((t) => {
    const activity = activityRows.find((a) => a.id === t.activityId);
    const { date, time } = hondurasParts(t.dueAt);
    const mine = options.studentId
      ? submissions.find((s) => s.taskId === t.id && s.studentId === options.studentId)
      : undefined;
    const myPoints = options.studentId ? points(t.id, options.studentId) : null;
    const forTask = submissions.filter((s) => s.taskId === t.id);
    return {
      id: t.id,
      assignmentId: t.assignmentId,
      title: t.title,
      instructions: t.instructions,
      dueAt: t.dueAt.toISOString(),
      dueDate: date,
      dueTime: time,
      allowLate: t.allowLate,
      points: activity?.maxPoints ?? null,
      periodId: activity?.periodId ?? null,
      periodName: activity?.periodName ?? null,
      attachments: attachments.filter((f) => f.taskId === t.id).map(toFileDto),
      createdAt: t.createdAt.toISOString(),
      stats:
        options.rosterSize === undefined
          ? null
          : {
              total: options.rosterSize,
              submitted: forTask.filter((s) => s.submittedAt).length,
              graded: forTask.filter((s) => points(t.id, s.studentId) !== null).length,
            },
      status: options.studentId ? statusOf(t, mine, myPoints, options.now) : null,
      myPoints,
    };
  });
}

/** Una entrega (o su ausencia) como la ve el maestro o el alumno. */
export function submissionDto(
  task: ClassTask,
  student: { studentId: string; name: string; userId?: string | null },
  submission: TaskSubmission | undefined,
  files: TaskFile[],
  points: number | null,
  now: Date,
): TaskSubmissionDto {
  return {
    studentId: student.studentId,
    studentName: student.name,
    text: submission?.text ?? "",
    submittedAt: submission?.submittedAt?.toISOString() ?? null,
    submittedByName: submission?.submittedByName ?? null,
    submittedByOther: Boolean(
      submission?.submittedByUserId && submission.submittedByUserId !== (student.userId ?? null),
    ),
    late: submission?.late ?? false,
    points,
    feedback: submission?.feedback ?? null,
    gradedAt: submission?.gradedAt?.toISOString() ?? null,
    files: submission ? files.filter((f) => f.submissionId === submission.id).map(toFileDto) : [],
    status: statusOf(task, submission, points, now),
  };
}

/** Los archivos entregados en una tarea (de todas las entregas). */
export async function submittedFiles(db: DbOrTx, taskId: string) {
  return db
    .select()
    .from(taskFiles)
    .where(and(eq(taskFiles.taskId, taskId), isNotNull(taskFiles.submissionId)))
    .orderBy(asc(taskFiles.createdAt));
}
