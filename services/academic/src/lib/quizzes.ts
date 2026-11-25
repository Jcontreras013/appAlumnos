import type {
  ClassQuizDto,
  QuizAnswerReviewDto,
  QuizAttemptDto,
  QuizQuestionDto,
  QuizStatus,
} from "@escolar/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import {
  activities,
  type ClassQuiz,
  gradingPeriods,
  type QuizAttempt,
  type QuizQuestion,
  quizAttempts,
  quizQuestions,
  scores,
} from "../db/schema";
import { hondurasParts } from "./tasks";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cómo va el examen para un alumno. */
export function quizStatus(quiz: ClassQuiz, attempt: QuizAttempt | undefined, now: Date): QuizStatus {
  if (attempt?.gradedAt) return "calificado";
  if (attempt?.submittedAt) return "entregado";
  if (attempt) return now <= attempt.deadline ? "en_curso" : "entregado";
  if (now < quiz.opensAt) return "proximo";
  if (now > quiz.closesAt) return "cerrado";
  return "disponible";
}

/** Puntos de una respuesta: las cerradas se califican solas; las abiertas, con lo que puso el maestro. */
export function answerPoints(q: QuizQuestion, attempt: QuizAttempt): number | null {
  const answer = attempt.answers[q.id];
  if (q.kind === "abierta")
    return attempt.reviewed[q.id] ?? (answer === undefined || answer === "" ? 0 : null);
  return answer !== undefined && answer === q.correct ? q.points : 0;
}

/**
 * Cierra un intento (al entregar, al vencer el tiempo o al revisar las abiertas): suma los puntos y,
 * si ya no falta revisar nada, deja la nota en la libreta llevada al valor de la actividad.
 */
export async function settleAttempt(
  tx: DbOrTx,
  quiz: ClassQuiz,
  questions: QuizQuestion[],
  attempt: QuizAttempt,
  now: Date,
  by?: { userId: string; name: string },
): Promise<QuizAttempt> {
  const perQuestion = questions.map((q) => answerPoints(q, attempt));
  const pending = perQuestion.some((p) => p === null);
  const raw = round2(perQuestion.reduce<number>((acc, p) => acc + (p ?? 0), 0));
  const rawMax = questions.reduce((acc, q) => acc + q.points, 0);
  const [activity] = quiz.activityId
    ? await tx.select().from(activities).where(eq(activities.id, quiz.activityId))
    : [];
  const score = pending ? null : activity ? round2(rawMax ? (raw / rawMax) * activity.maxPoints : 0) : raw;
  const submittedAt = attempt.submittedAt ?? (now > attempt.deadline ? attempt.deadline : now);
  const [updated] = await tx
    .update(quizAttempts)
    .set({
      submittedAt,
      submittedByUserId: attempt.submittedByUserId ?? by?.userId ?? null,
      submittedByName: attempt.submittedByName ?? by?.name ?? null,
      rawScore: raw,
      score,
      gradedAt: pending ? null : now,
      updatedAt: now,
    })
    .where(eq(quizAttempts.id, attempt.id))
    .returning();
  if (activity && score !== null) {
    await tx
      .insert(scores)
      .values({
        schoolId: quiz.schoolId,
        activityId: activity.id,
        studentId: attempt.studentId,
        points: score,
        updatedByUserId: by?.userId ?? quiz.createdByUserId,
      })
      .onConflictDoUpdate({
        target: [scores.activityId, scores.studentId],
        set: { points: score, updatedAt: now },
      });
  }
  return updated ?? attempt;
}

/** Los intentos que se quedaron abiertos cuando se acabó el tiempo se entregan solos. */
export async function settleExpired(db: DbOrTx, quiz: ClassQuiz, now: Date): Promise<QuizAttempt[]> {
  const attempts = await db.select().from(quizAttempts).where(eq(quizAttempts.quizId, quiz.id));
  const expired = attempts.filter((a) => !a.submittedAt && now > a.deadline);
  if (!expired.length) return attempts;
  const questions = await questionsOf(db, quiz.id);
  const settled = new Map<string, QuizAttempt>();
  for (const a of expired) settled.set(a.id, await settleAttempt(db, quiz, questions, a, now));
  return attempts.map((a) => settled.get(a.id) ?? a);
}

export function questionsOf(db: DbOrTx, quizId: string) {
  return db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(asc(quizQuestions.position));
}

/** Orden de las preguntas para un intento: barajadas (siempre igual para ese intento) si el examen lo pide. */
export function orderFor(
  quiz: ClassQuiz,
  questions: QuizQuestion[],
  attemptId: string | null,
): QuizQuestion[] {
  if (!quiz.shuffle || !attemptId) return questions;
  let seed = [...attemptId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as QuizQuestion, shuffled[i] as QuizQuestion];
  }
  return shuffled;
}

export const questionDto = (q: QuizQuestion, withAnswer: boolean): QuizQuestionDto => ({
  id: q.id,
  kind: q.kind,
  prompt: q.prompt,
  options: q.options,
  points: q.points,
  correct: withAnswer ? (q.correct ?? null) : null,
});

export function attemptDto(
  quiz: ClassQuiz,
  questions: QuizQuestion[],
  student: { studentId: string; name: string },
  attempt: QuizAttempt | undefined,
  now: Date,
): QuizAttemptDto {
  const answers: QuizAnswerReviewDto[] = attempt
    ? questions.map((q) => ({
        questionId: q.id,
        answer: attempt.answers[q.id] ?? null,
        points: attempt.submittedAt || now > attempt.deadline ? answerPoints(q, attempt) : null,
      }))
    : [];
  return {
    studentId: student.studentId,
    studentName: student.name,
    startedAt: attempt?.startedAt.toISOString() ?? null,
    deadline: attempt?.deadline.toISOString() ?? null,
    submittedAt: attempt?.submittedAt?.toISOString() ?? null,
    submittedByName: attempt?.submittedByName ?? null,
    answers,
    rawScore: attempt?.rawScore ?? null,
    score: attempt?.score ?? null,
    pendingReview: Boolean(attempt?.submittedAt && !attempt.gradedAt),
    status: quizStatus(quiz, attempt, now),
  };
}

/** Los exámenes de una clase listos para mostrar (como `taskDtos`). */
export async function quizDtos(
  db: DbOrTx,
  quizzes: ClassQuiz[],
  options: { now: Date; rosterSize?: number; studentId?: string },
): Promise<ClassQuizDto[]> {
  if (!quizzes.length) return [];
  const ids = quizzes.map((q) => q.id);
  const activityIds = quizzes.map((q) => q.activityId).filter((a): a is string => a !== null);
  const [questions, attempts, activityRows] = await Promise.all([
    db.select().from(quizQuestions).where(inArray(quizQuestions.quizId, ids)),
    db.select().from(quizAttempts).where(inArray(quizAttempts.quizId, ids)),
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
  return quizzes.map((q) => {
    const activity = activityRows.find((a) => a.id === q.activityId);
    const own = questions.filter((x) => x.quizId === q.id);
    const forQuiz = attempts.filter((a) => a.quizId === q.id);
    const mine = options.studentId ? forQuiz.find((a) => a.studentId === options.studentId) : undefined;
    const opens = hondurasParts(q.opensAt);
    const closes = hondurasParts(q.closesAt);
    return {
      id: q.id,
      assignmentId: q.assignmentId,
      title: q.title,
      instructions: q.instructions,
      opensAt: q.opensAt.toISOString(),
      closesAt: q.closesAt.toISOString(),
      opensDate: opens.date,
      opensTime: opens.time,
      closesDate: closes.date,
      closesTime: closes.time,
      timeLimitMinutes: q.timeLimitMinutes,
      shuffle: q.shuffle,
      published: q.published,
      points: activity?.maxPoints ?? null,
      periodId: activity?.periodId ?? null,
      periodName: activity?.periodName ?? null,
      questionCount: own.length,
      rawPoints: round2(own.reduce((acc, x) => acc + x.points, 0)),
      stats:
        options.rosterSize === undefined
          ? null
          : {
              total: options.rosterSize,
              submitted: forQuiz.filter((a) => a.submittedAt || options.now > a.deadline).length,
              graded: forQuiz.filter((a) => a.gradedAt).length,
            },
      status: options.studentId ? quizStatus(q, mine, options.now) : null,
      myScore: mine?.gradedAt ? (mine.score ?? null) : null,
    };
  });
}
