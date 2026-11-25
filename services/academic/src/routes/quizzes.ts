import { randomUUID } from "node:crypto";
import { badRequest, conflict, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type ClassQuizDetailDto,
  type ClassQuizDto,
  classQuizInputSchema,
  hondurasInstant,
  type QuizAttemptDto,
  type QuizQuestionDto,
  quizAnswersInputSchema,
  quizQuestionInputSchema,
  quizReviewInputSchema,
} from "@escolar/shared";
import { and, count, eq, max } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import {
  activities,
  type ClassQuiz,
  classQuizzes,
  gradingPeriods,
  quizAttempts,
  quizQuestions,
  scores,
  students,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { type ClassAccess, classAccess } from "../lib/classroom";
import { rosterOf, saveActivity } from "../lib/evaluation";
import {
  attemptDto,
  orderFor,
  questionDto,
  questionsOf,
  quizDtos,
  settleAttempt,
  settleExpired,
} from "../lib/quizzes";

const idParams = z.object({ id: z.uuid() });
const reviewParams = z.object({ id: z.uuid(), studentId: z.uuid() });
const studentQuery = z.object({ alumno: z.uuid().optional() });
const publishInput = z.object({ published: z.boolean() });

const READERS = ["admin", "coordinador", "secretaria", "docente", "padre", "estudiante"] as const;

function studentFor(access: ClassAccess, alumno?: string): string {
  if (access.viewer !== "alumno" && access.viewer !== "familia") throw notFound("Examen no encontrado");
  const chosen = alumno && access.studentIds.includes(alumno) ? alumno : access.studentIds[0];
  if (!chosen) throw notFound("Examen no encontrado");
  return chosen;
}

/**
 * Exámenes en línea. El maestro los arma (selección múltiple, verdadero o falso y preguntas
 * abiertas), elige cuándo abren y cierran y el tiempo para resolverlos, y los publica. El alumno (o su
 * familia) lo presenta una vez; las cerradas se califican solas y las abiertas las revisa el maestro.
 * La nota cae en la libreta, llevada al valor que el examen tiene en el parcial.
 */
export async function quizRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const readers = { preHandler: [app.authenticate, requireRole(...READERS)] };

  async function quizContext(request: FastifyRequest, id: string) {
    const [quiz] = await db
      .select()
      .from(classQuizzes)
      .where(and(eq(classQuizzes.schoolId, tenantOf(request)), eq(classQuizzes.id, id)));
    if (!quiz) throw notFound("Examen no encontrado");
    const access = await classAccess(db, request.auth, quiz.assignmentId, today());
    // Mientras se arma, el examen solo lo ve quien lo puede editar.
    if (!quiz.published && !access.canEdit && access.viewer !== "oficina")
      throw notFound("Examen no encontrado");
    return { quiz, access };
  }

  async function editableQuiz(request: FastifyRequest, id: string) {
    const context = await quizContext(request, id);
    if (!context.access.canEdit) throw notFound("Examen no encontrado");
    return context;
  }

  /** Con un intento empezado, las preguntas ya no se cambian (los alumnos las están viendo). */
  async function noAttempts(quizId: string) {
    const [started] = await db
      .select({ n: count() })
      .from(quizAttempts)
      .where(eq(quizAttempts.quizId, quizId));
    if ((started?.n ?? 0) > 0)
      throw conflict("Ya hay alumnos que empezaron el examen: las preguntas no se cambian");
  }

  async function periodOrThrow(schoolId: string, schoolYearId: string, periodId: string) {
    const [period] = await db
      .select()
      .from(gradingPeriods)
      .where(
        and(
          eq(gradingPeriods.schoolId, schoolId),
          eq(gradingPeriods.id, periodId),
          eq(gradingPeriods.schoolYearId, schoolYearId),
        ),
      );
    if (!period) throw badRequest("Ese parcial no es de este año");
  }

  async function oneDto(quiz: ClassQuiz, access: ClassAccess, studentId?: string): Promise<ClassQuizDto> {
    const rosterSize = studentId
      ? undefined
      : (await rosterOf(db, quiz.schoolId, [access.assignment.sectionId])).length;
    const [dto] = await quizDtos(db, [quiz], { now: new Date(), rosterSize, studentId });
    if (!dto) throw notFound("Examen no encontrado");
    return dto;
  }

  /** Crea, cambia o quita la actividad del examen en la libreta, igual que con las tareas. */
  async function syncActivity(
    tx: DbOrTx,
    input: { title: string; points?: number; periodId?: string; closesDate: string },
    quiz: { activityId: string | null; assignmentId: string; schoolId: string },
    userId: string,
  ): Promise<string | null> {
    if (input.points !== undefined && input.periodId) {
      const activityId = quiz.activityId ?? randomUUID();
      await saveActivity(tx, {
        id: activityId,
        schoolId: quiz.schoolId,
        assignmentId: quiz.assignmentId,
        periodId: input.periodId,
        name: input.title,
        maxPoints: input.points,
        date: input.closesDate,
        userId,
      });
      return activityId;
    }
    if (quiz.activityId) {
      const [graded] = await tx
        .select({ n: count() })
        .from(scores)
        .where(eq(scores.activityId, quiz.activityId));
      if ((graded?.n ?? 0) > 0)
        throw conflict("El examen ya tiene notas en la libreta: no se le puede quitar el valor");
      await tx.delete(activities).where(eq(activities.id, quiz.activityId));
    }
    return null;
  }

  // ── El maestro arma el examen ──
  app.post("/classes/:id/quizzes", readers, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const access = await classAccess(db, request.auth, id, today());
    if (!access.canEdit) throw notFound("Clase no encontrada");
    const input = parseOrThrow(classQuizInputSchema, request.body);
    if (input.periodId) await periodOrThrow(schoolId, access.assignment.schoolYearId, input.periodId);
    const quiz = await db.transaction(async (tx) => {
      const activityId = await syncActivity(
        tx,
        input,
        { activityId: null, assignmentId: id, schoolId },
        request.auth.userId,
      );
      const [row] = await tx
        .insert(classQuizzes)
        .values({
          schoolId,
          assignmentId: id,
          activityId,
          title: input.title,
          instructions: input.instructions,
          opensAt: hondurasInstant(input.opensDate, input.opensTime),
          closesAt: hondurasInstant(input.closesDate, input.closesTime),
          timeLimitMinutes: input.timeLimitMinutes ?? null,
          shuffle: input.shuffle,
          createdByUserId: request.auth.userId,
        })
        .returning();
      if (!row) throw new Error("No se guardó el examen");
      return row;
    });
    return reply.status(201).send(await oneDto(quiz, access));
  });

  app.put("/class-quizzes/:id", readers, async (request): Promise<ClassQuizDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { quiz, access } = await editableQuiz(request, id);
    const input = parseOrThrow(classQuizInputSchema, request.body);
    if (input.periodId) await periodOrThrow(schoolId, access.assignment.schoolYearId, input.periodId);
    const updated = await db.transaction(async (tx) => {
      const activityId = await syncActivity(tx, input, quiz, request.auth.userId);
      const [row] = await tx
        .update(classQuizzes)
        .set({
          activityId,
          title: input.title,
          instructions: input.instructions,
          opensAt: hondurasInstant(input.opensDate, input.opensTime),
          closesAt: hondurasInstant(input.closesDate, input.closesTime),
          timeLimitMinutes: input.timeLimitMinutes ?? null,
          shuffle: input.shuffle,
          updatedAt: new Date(),
        })
        .where(eq(classQuizzes.id, id))
        .returning();
      if (!row) throw notFound("Examen no encontrado");
      return row;
    });
    return oneDto(updated, access);
  });

  app.delete("/class-quizzes/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { quiz } = await editableQuiz(request, id);
    await db.transaction(async (tx) => {
      await tx.delete(classQuizzes).where(eq(classQuizzes.id, id));
      if (quiz.activityId) await tx.delete(activities).where(eq(activities.id, quiz.activityId));
      await audit(tx, request, {
        action: "class_quiz.deleted",
        entityType: "class_quiz",
        entityId: id,
        data: { title: quiz.title, assignmentId: quiz.assignmentId },
      });
    });
    return reply.status(204).send();
  });

  app.post("/class-quizzes/:id/questions", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { quiz } = await editableQuiz(request, id);
    await noAttempts(id);
    const input = parseOrThrow(quizQuestionInputSchema, request.body);
    const [last] = await db
      .select({ position: max(quizQuestions.position) })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, id));
    const [row] = await db
      .insert(quizQuestions)
      .values({
        schoolId: quiz.schoolId,
        quizId: id,
        position: (last?.position ?? 0) + 1,
        kind: input.kind,
        prompt: input.prompt,
        options: input.options,
        correct: input.kind === "abierta" ? null : input.correct,
        points: input.points,
      })
      .returning();
    if (!row) throw new Error("No se guardó la pregunta");
    return reply.status(201).send(questionDto(row, true));
  });

  async function questionContext(request: FastifyRequest, id: string) {
    const [question] = await db
      .select()
      .from(quizQuestions)
      .where(and(eq(quizQuestions.schoolId, tenantOf(request)), eq(quizQuestions.id, id)));
    if (!question) throw notFound("Pregunta no encontrada");
    await editableQuiz(request, question.quizId);
    await noAttempts(question.quizId);
    return question;
  }

  app.put("/quiz-questions/:id", readers, async (request): Promise<QuizQuestionDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    await questionContext(request, id);
    const input = parseOrThrow(quizQuestionInputSchema, request.body);
    const [row] = await db
      .update(quizQuestions)
      .set({
        kind: input.kind,
        prompt: input.prompt,
        options: input.options,
        correct: input.kind === "abierta" ? null : input.correct,
        points: input.points,
      })
      .where(eq(quizQuestions.id, id))
      .returning();
    if (!row) throw notFound("Pregunta no encontrada");
    return questionDto(row, true);
  });

  app.delete("/quiz-questions/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    await questionContext(request, id);
    await db.delete(quizQuestions).where(eq(quizQuestions.id, id));
    return reply.status(204).send();
  });

  /** Publicar (los alumnos lo ven) o volverlo borrador (solo si nadie lo ha empezado). */
  app.post("/class-quizzes/:id/publish", readers, async (request): Promise<ClassQuizDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { quiz, access } = await editableQuiz(request, id);
    const { published } = parseOrThrow(publishInput, request.body);
    if (published) {
      const [questions] = await db
        .select({ n: count() })
        .from(quizQuestions)
        .where(eq(quizQuestions.quizId, id));
      if (!questions?.n) throw badRequest("Agrega al menos una pregunta antes de publicarlo");
    } else {
      await noAttempts(id);
    }
    const [row] = await db
      .update(classQuizzes)
      .set({ published, updatedAt: new Date() })
      .where(eq(classQuizzes.id, id))
      .returning();
    return oneDto(row ?? quiz, access);
  });

  /**
   * El maestro revisa un examen: puntos de las preguntas abiertas (con todo revisado, la nota va a la
   * libreta), un comentario en cada pregunta y uno general. El alumno y su familia los ven.
   */
  app.put(
    "/class-quizzes/:id/attempts/:studentId/review",
    readers,
    async (request): Promise<QuizAttemptDto> => {
      const { id, studentId } = parseOrThrow(reviewParams, request.params);
      const { quiz } = await editableQuiz(request, id);
      const { points, comments, feedback } = parseOrThrow(quizReviewInputSchema, request.body);
      const questions = await questionsOf(db, id);
      const [attempt] = await db
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.quizId, id), eq(quizAttempts.studentId, studentId)));
      if (!attempt) throw notFound("Ese alumno no presentó el examen");
      const now = new Date();
      if (!attempt.submittedAt && now <= attempt.deadline)
        throw conflict("El alumno todavía lo está resolviendo");
      for (const [questionId, value] of Object.entries(points)) {
        const q = questions.find((x) => x.id === questionId);
        if (q?.kind !== "abierta") throw badRequest("Solo se revisan a mano las preguntas abiertas");
        if (value > q.points) throw badRequest(`Esa pregunta vale ${q.points} puntos`);
      }
      const reviewed = { ...attempt.reviewed, ...points };
      const notes = { ...attempt.comments };
      for (const [questionId, text] of Object.entries(comments ?? {})) {
        if (!questions.some((x) => x.id === questionId))
          throw badRequest("Esa pregunta no es de este examen");
        if (text) notes[questionId] = text;
        else delete notes[questionId];
      }
      const overall = feedback === undefined ? attempt.feedback : feedback || null;
      const settled = await db.transaction(async (tx) => {
        await tx
          .update(quizAttempts)
          .set({ reviewed, comments: notes, feedback: overall })
          .where(eq(quizAttempts.id, attempt.id));
        return settleAttempt(
          tx,
          quiz,
          questions,
          { ...attempt, reviewed, comments: notes, feedback: overall },
          now,
          {
            userId: request.auth.userId,
            name: request.auth.name,
          },
        );
      });
      const [student] = await db
        .select({ firstNames: students.firstNames, lastNames: students.lastNames })
        .from(students)
        .where(eq(students.id, studentId));
      return attemptDto(
        quiz,
        questions,
        { studentId, name: student ? `${student.lastNames}, ${student.firstNames}` : "" },
        settled,
        now,
      );
    },
  );

  // ── Ver el examen ──
  app.get("/class-quizzes/:id", readers, async (request): Promise<ClassQuizDetailDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { alumno } = parseOrThrow(studentQuery, request.query);
    const { quiz, access } = await quizContext(request, id);
    const now = new Date();
    const attempts = await settleExpired(db, quiz, now);
    const questions = await questionsOf(db, id);
    const base = {
      subjectName: access.assignment.subjectName,
      sectionLabel: access.assignment.sectionLabel,
      viewer: access.viewer,
      canEdit: access.canEdit,
    };
    if (access.viewer === "docente" || access.viewer === "oficina") {
      const roster = await rosterOf(db, schoolId, [access.assignment.sectionId]);
      return {
        ...base,
        quiz: await oneDto(quiz, access),
        questions: questions.map((q) => questionDto(q, true)),
        attempts: roster.map((r) =>
          attemptDto(
            quiz,
            questions,
            { studentId: r.studentId, name: `${r.lastNames}, ${r.firstNames}` },
            attempts.find((a) => a.studentId === r.studentId),
            now,
          ),
        ),
        mine: null,
        students: [],
      };
    }
    const studentId = studentFor(access, alumno);
    const mine = attempts.find((a) => a.studentId === studentId);
    const roster = await rosterOf(db, schoolId, [access.assignment.sectionId]);
    // Las preguntas se ven al empezar; las respuestas correctas, cuando el examen ya cerró.
    const showAnswers = now > quiz.closesAt && Boolean(mine);
    return {
      ...base,
      quiz: await oneDto(quiz, access, studentId),
      questions: mine ? orderFor(quiz, questions, mine.id).map((q) => questionDto(q, showAnswers)) : [],
      attempts: null,
      mine: attemptDto(quiz, questions, { studentId, name: "" }, mine, now),
      students: roster
        .filter((r) => access.studentIds.includes(r.studentId))
        .map((r) => ({ id: r.studentId, name: `${r.firstNames} ${r.lastNames}` })),
    };
  });

  // ── El alumno (o su familia) lo presenta ──
  app.post("/class-quizzes/:id/start", readers, async (request): Promise<{ started: boolean }> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { alumno } = parseOrThrow(studentQuery, request.query);
    const { quiz, access } = await quizContext(request, id);
    const studentId = studentFor(access, alumno);
    const now = new Date();
    if (now < quiz.opensAt) throw conflict("El examen todavía no abre");
    if (now > quiz.closesAt) throw conflict("El examen ya cerró");
    const limit = quiz.timeLimitMinutes
      ? new Date(now.getTime() + quiz.timeLimitMinutes * 60_000)
      : quiz.closesAt;
    const deadline = limit < quiz.closesAt ? limit : quiz.closesAt;
    // Si ya lo empezó (otra pestaña, se le fue el internet), sigue con el mismo intento y el mismo reloj.
    await db
      .insert(quizAttempts)
      .values({ schoolId: quiz.schoolId, quizId: id, studentId, startedAt: now, deadline })
      .onConflictDoNothing();
    return { started: true };
  });

  app.put("/class-quizzes/:id/answers", readers, async (request): Promise<QuizAttemptDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { alumno } = parseOrThrow(studentQuery, request.query);
    const input = parseOrThrow(quizAnswersInputSchema, request.body);
    const { quiz, access } = await quizContext(request, id);
    const studentId = studentFor(access, alumno);
    const [attempt] = await db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.quizId, id), eq(quizAttempts.studentId, studentId)));
    if (!attempt) throw conflict("Primero empieza el examen");
    const now = new Date();
    if (attempt.submittedAt) throw conflict("Ya entregaste este examen");
    const questions = await questionsOf(db, id);
    // Pasada la hora (más un minuto de gracia por la conexión), ya no se aceptan respuestas.
    const late = now.getTime() > attempt.deadline.getTime() + 60_000;
    const answers = { ...attempt.answers };
    if (!late) {
      for (const [questionId, value] of Object.entries(input.answers)) {
        const q = questions.find((x) => x.id === questionId);
        if (!q) throw badRequest("Esa pregunta no es de este examen");
        const valid =
          (q.kind === "opcion" && typeof value === "number" && value < q.options.length) ||
          (q.kind === "vf" && typeof value === "boolean") ||
          (q.kind === "abierta" && typeof value === "string");
        if (!valid) throw badRequest("Respuesta inválida");
        answers[questionId] = value;
      }
    }
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(quizAttempts)
        .set({ answers, updatedAt: now })
        .where(eq(quizAttempts.id, attempt.id))
        .returning();
      const current = row ?? { ...attempt, answers };
      if (input.finish || late) {
        return settleAttempt(tx, quiz, questions, current, now, {
          userId: request.auth.userId,
          name: request.auth.name,
        });
      }
      return current;
    });
    return attemptDto(quiz, orderFor(quiz, questions, saved.id), { studentId, name: "" }, saved, now);
  });
}

/** Los exámenes de una clase para su página (el alumno solo ve los publicados). */
export async function classQuizzesFor(
  db: DbOrTx,
  schoolId: string,
  access: ClassAccess,
): Promise<ClassQuizDto[]> {
  const portal = access.viewer === "alumno" || access.viewer === "familia";
  const rows = (
    await db.select().from(classQuizzes).where(eq(classQuizzes.assignmentId, access.assignment.id))
  ).filter((q) => q.published || !portal);
  const now = new Date();
  for (const quiz of rows) await settleExpired(db, quiz, now);
  const upcoming = rows
    .filter((q) => q.closesAt >= now)
    .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());
  const past = rows
    .filter((q) => q.closesAt < now)
    .sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime());
  return quizDtos(db, [...upcoming, ...past], {
    now,
    rosterSize: portal ? undefined : (await rosterOf(db, schoolId, [access.assignment.sectionId])).length,
    studentId: portal ? access.studentIds[0] : undefined,
  });
}
