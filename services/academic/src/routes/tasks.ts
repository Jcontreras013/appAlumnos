import { randomUUID } from "node:crypto";
import {
  badRequest,
  conflict,
  contentDispositionFor,
  notFound,
  parseOrThrow,
  parseRange,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  CLASS_FILE_MAX_BYTES,
  type ClassTaskDetailDto,
  type ClassTaskDto,
  classTaskInputSchema,
  hondurasInstant,
  SUBMISSION_FILE_MAX_BYTES,
  SUBMISSION_FILES_MAX,
  type TaskSubmissionDto,
  taskGradeInputSchema,
  taskSubmissionInputSchema,
} from "@escolar/shared";
import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import {
  activities,
  type ClassTask,
  classTasks,
  gradingPeriods,
  scores,
  students,
  type TaskSubmission,
  taskFiles,
  taskSubmissions,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { type ClassAccess, classAccess } from "../lib/classroom";
import { rosterOf, saveActivity } from "../lib/evaluation";
import {
  pointsFor,
  publishAtFor,
  submissionDto,
  submittedFiles,
  taskDtos,
  taskVisibility,
} from "../lib/tasks";
import { storeUpload } from "../lib/uploads";

const idParams = z.object({ id: z.uuid() });
const gradeParams = z.object({ id: z.uuid(), studentId: z.uuid() });
const studentQuery = z.object({ alumno: z.uuid().optional() });

const READERS = ["admin", "coordinador", "secretaria", "docente", "padre", "estudiante"] as const;

/** El alumno a nombre del que entrega: el propio, o el hijo elegido por la familia. */
function studentFor(access: ClassAccess, alumno?: string): string {
  if (access.viewer !== "alumno" && access.viewer !== "familia") throw notFound("Tarea no encontrada");
  const chosen = alumno && access.studentIds.includes(alumno) ? alumno : access.studentIds[0];
  if (!chosen) throw notFound("Tarea no encontrada");
  return chosen;
}

const closed = (task: ClassTask, now: Date) => now > task.dueAt && !task.allowLate;

/**
 * Tareas del aula virtual. El maestro las publica con instrucciones, fecha de entrega y archivos; si
 * llevan nota, quedan como actividad del parcial en la libreta. El alumno (o su familia) entrega texto
 * y archivos; el maestro califica con un comentario y la nota cae en la libreta.
 */
export async function taskRoutes(app: FastifyInstance, { db, files, today }: AcademicDeps) {
  const readers = { preHandler: [app.authenticate, requireRole(...READERS)] };

  async function taskContext(request: FastifyRequest, id: string) {
    const [task] = await db
      .select()
      .from(classTasks)
      .where(and(eq(classTasks.schoolId, tenantOf(request)), eq(classTasks.id, id)));
    if (!task) throw notFound("Tarea no encontrada");
    const access = await classAccess(db, request.auth, task.assignmentId, today());
    // Alumnos y familias no ven los borradores ni las programadas antes de tiempo.
    const portal = access.viewer === "alumno" || access.viewer === "familia";
    if (portal && taskVisibility(task, new Date()) !== "publicada") throw notFound("Tarea no encontrada");
    return { task, access };
  }

  async function editableTask(request: FastifyRequest, id: string) {
    const context = await taskContext(request, id);
    if (!context.access.canEdit) throw notFound("Tarea no encontrada");
    return context;
  }

  /** El parcial tiene que ser del año de la clase. */
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
    return period;
  }

  async function rosterSize(schoolId: string, sectionId: string) {
    return (await rosterOf(db, schoolId, [sectionId])).length;
  }

  async function oneDto(task: ClassTask, access: ClassAccess, studentId?: string): Promise<ClassTaskDto> {
    const [dto] = await taskDtos(db, [task], {
      now: new Date(),
      rosterSize: access.canEdit ? await rosterSize(task.schoolId, access.assignment.sectionId) : undefined,
      studentId,
    });
    if (!dto) throw notFound("Tarea no encontrada");
    return dto;
  }

  // ── El maestro ──
  app.post("/classes/:id/tasks", readers, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const access = await classAccess(db, request.auth, id, today());
    if (!access.canEdit) throw notFound("Clase no encontrada");
    const input = parseOrThrow(classTaskInputSchema, request.body);
    if (input.periodId) await periodOrThrow(schoolId, access.assignment.schoolYearId, input.periodId);
    const task = await db.transaction(async (tx) => {
      let activityId: string | null = null;
      if (input.points !== undefined && input.periodId) {
        activityId = randomUUID();
        await saveActivity(tx, {
          id: activityId,
          schoolId,
          assignmentId: id,
          periodId: input.periodId,
          name: input.title,
          maxPoints: input.points,
          date: input.dueDate,
          userId: request.auth.userId,
        });
      }
      const [row] = await tx
        .insert(classTasks)
        .values({
          schoolId,
          assignmentId: id,
          activityId,
          title: input.title,
          instructions: input.instructions,
          dueAt: hondurasInstant(input.dueDate, input.dueTime),
          allowLate: input.allowLate,
          publishAt: publishAtFor(input, null, new Date()),
          createdByUserId: request.auth.userId,
        })
        .returning();
      if (!row) throw new Error("No se guardó la tarea");
      return row;
    });
    return reply.status(201).send(await oneDto(task, access));
  });

  app.put("/class-tasks/:id", readers, async (request): Promise<ClassTaskDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { task, access } = await editableTask(request, id);
    const input = parseOrThrow(classTaskInputSchema, request.body);
    if (input.periodId) await periodOrThrow(schoolId, access.assignment.schoolYearId, input.periodId);
    const updated = await db.transaction(async (tx) => {
      let activityId = task.activityId;
      if (input.points !== undefined && input.periodId) {
        activityId ??= randomUUID();
        await saveActivity(tx, {
          id: activityId,
          schoolId,
          assignmentId: task.assignmentId,
          periodId: input.periodId,
          name: input.title,
          maxPoints: input.points,
          date: input.dueDate,
          userId: request.auth.userId,
        });
      } else if (activityId) {
        // Quitarle la nota a la tarea borra su columna de la libreta, solo si todavía está vacía.
        const [graded] = await tx
          .select({ n: count() })
          .from(scores)
          .where(eq(scores.activityId, activityId));
        if ((graded?.n ?? 0) > 0) {
          throw conflict("La tarea ya tiene notas en la libreta: no se le puede quitar el valor");
        }
        await tx.delete(activities).where(eq(activities.id, activityId));
        activityId = null;
      }
      const [row] = await tx
        .update(classTasks)
        .set({
          activityId,
          title: input.title,
          instructions: input.instructions,
          dueAt: hondurasInstant(input.dueDate, input.dueTime),
          allowLate: input.allowLate,
          publishAt: publishAtFor(input, task.publishAt, new Date()),
          updatedAt: new Date(),
        })
        .where(eq(classTasks.id, id))
        .returning();
      if (!row) throw notFound("Tarea no encontrada");
      return row;
    });
    return oneDto(updated, access);
  });

  /** Borrar una tarea borra también las entregas y su columna de la libreta (con sus notas). */
  app.delete("/class-tasks/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { task } = await editableTask(request, id);
    const stored = await db
      .select({ key: taskFiles.storageKey })
      .from(taskFiles)
      .where(eq(taskFiles.taskId, id));
    await db.transaction(async (tx) => {
      await tx.delete(classTasks).where(eq(classTasks.id, id));
      if (task.activityId) await tx.delete(activities).where(eq(activities.id, task.activityId));
      await audit(tx, request, {
        action: "class_task.deleted",
        entityType: "class_task",
        entityId: id,
        data: { title: task.title, assignmentId: task.assignmentId },
      });
    });
    for (const { key } of stored) await files.delete(key).catch(() => {});
    return reply.status(204).send();
  });

  app.put("/class-tasks/:id/grades/:studentId", readers, async (request): Promise<TaskSubmissionDto> => {
    const schoolId = tenantOf(request);
    const { id, studentId } = parseOrThrow(gradeParams, request.params);
    const { task, access } = await editableTask(request, id);
    const input = parseOrThrow(taskGradeInputSchema, request.body);
    const roster = await rosterOf(db, schoolId, [access.assignment.sectionId]);
    const student = roster.find((r) => r.studentId === studentId);
    if (!student) throw badRequest("Ese alumno no está en la sección");
    const [activity] = task.activityId
      ? await db.select().from(activities).where(eq(activities.id, task.activityId))
      : [];
    const max = activity?.maxPoints ?? 100;
    if (input.points !== null && input.points > max) {
      throw badRequest(`La nota máxima de esta tarea es ${max}`, {
        fields: [{ path: "points", message: `Máximo ${max}` }],
      });
    }
    const now = new Date();
    const submission = await db.transaction(async (tx) => {
      const values = {
        points: input.points,
        feedback: input.feedback ?? null,
        gradedAt: input.points === null ? null : now,
        gradedByUserId: request.auth.userId,
        updatedAt: now,
      };
      const [row] = await tx
        .insert(taskSubmissions)
        .values({ schoolId, taskId: id, studentId, ...values })
        .onConflictDoUpdate({
          target: [taskSubmissions.taskId, taskSubmissions.studentId],
          set: values,
        })
        .returning();
      if (activity) {
        await tx
          .insert(scores)
          .values({
            schoolId,
            activityId: activity.id,
            studentId,
            points: input.points,
            updatedByUserId: request.auth.userId,
          })
          .onConflictDoUpdate({
            target: [scores.activityId, scores.studentId],
            set: { points: input.points, updatedByUserId: request.auth.userId, updatedAt: now },
          });
      }
      return row;
    });
    const filesOf = await submittedFiles(db, id);
    return submissionDto(
      task,
      { studentId, name: `${student.firstNames} ${student.lastNames}`, userId: student.userId },
      submission,
      filesOf,
      input.points,
      now,
    );
  });

  // ── Ver una tarea ──
  app.get("/class-tasks/:id", readers, async (request): Promise<ClassTaskDetailDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { alumno } = parseOrThrow(studentQuery, request.query);
    const { task, access } = await taskContext(request, id);
    const now = new Date();
    const base = {
      subjectName: access.assignment.subjectName,
      sectionLabel: access.assignment.sectionLabel,
      viewer: access.viewer,
      canEdit: access.canEdit,
    };
    if (access.viewer === "docente" || access.viewer === "oficina") {
      const roster = await rosterOf(db, schoolId, [access.assignment.sectionId]);
      const subs = await db.select().from(taskSubmissions).where(eq(taskSubmissions.taskId, id));
      const filesOf = await submittedFiles(db, id);
      const points = await pointsFor(db, [task], subs);
      return {
        ...base,
        task: await oneDto(task, { ...access, canEdit: true }),
        submissions: roster.map((r) =>
          submissionDto(
            task,
            { studentId: r.studentId, name: `${r.lastNames}, ${r.firstNames}`, userId: r.userId },
            subs.find((s) => s.studentId === r.studentId),
            filesOf,
            points(id, r.studentId),
            now,
          ),
        ),
        mine: null,
        canSubmit: false,
        students: [],
      };
    }
    const studentId = studentFor(access, alumno);
    const mine = await mySubmission(task, studentId, now);
    const roster = await rosterOf(db, schoolId, [access.assignment.sectionId]);
    return {
      ...base,
      task: await oneDto(task, access, studentId),
      submissions: null,
      mine,
      canSubmit: mine.status !== "calificada" && !closed(task, now),
      students: roster
        .filter((r) => access.studentIds.includes(r.studentId))
        .map((r) => ({ id: r.studentId, name: `${r.firstNames} ${r.lastNames}` })),
    };
  });

  async function mySubmission(task: ClassTask, studentId: string, now: Date) {
    const [sub] = await db
      .select()
      .from(taskSubmissions)
      .where(and(eq(taskSubmissions.taskId, task.id), eq(taskSubmissions.studentId, studentId)));
    const filesOf = sub ? await db.select().from(taskFiles).where(eq(taskFiles.submissionId, sub.id)) : [];
    const points = await pointsFor(db, [task], sub ? [sub] : []);
    const [student] = await db
      .select({ userId: students.userId, firstNames: students.firstNames, lastNames: students.lastNames })
      .from(students)
      .where(eq(students.id, studentId));
    return submissionDto(
      task,
      {
        studentId,
        name: student ? `${student.firstNames} ${student.lastNames}` : "",
        userId: student?.userId,
      },
      sub,
      filesOf,
      points(task.id, studentId),
      now,
    );
  }

  // ── El alumno o su familia ──
  /** Revisa que todavía se pueda cambiar la entrega: ni calificada ni cerrada. */
  async function openSubmission(request: FastifyRequest, id: string, alumno?: string) {
    const { task, access } = await taskContext(request, id);
    const studentId = studentFor(access, alumno);
    const now = new Date();
    const [sub] = await db
      .select()
      .from(taskSubmissions)
      .where(and(eq(taskSubmissions.taskId, id), eq(taskSubmissions.studentId, studentId)));
    const points = await pointsFor(db, [task], sub ? [sub] : []);
    if (points(id, studentId) !== null) throw conflict("Esta tarea ya está calificada");
    if (closed(task, now)) throw conflict("La fecha de entrega ya pasó y la tarea no acepta entregas tarde");
    return { task, access, studentId, sub, now };
  }

  async function draftFor(task: ClassTask, studentId: string, existing: TaskSubmission | undefined) {
    if (existing) return existing;
    const [row] = await db
      .insert(taskSubmissions)
      .values({ schoolId: task.schoolId, taskId: task.id, studentId })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [again] = await db
      .select()
      .from(taskSubmissions)
      .where(and(eq(taskSubmissions.taskId, task.id), eq(taskSubmissions.studentId, studentId)));
    if (!again) throw new Error("No se guardó la entrega");
    return again;
  }

  app.put("/class-tasks/:id/submission", readers, async (request): Promise<TaskSubmissionDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const { alumno } = parseOrThrow(studentQuery, request.query);
    const input = parseOrThrow(taskSubmissionInputSchema, request.body);
    const { task, studentId, sub, now } = await openSubmission(request, id, alumno);
    if (input.turnIn && !input.text) {
      const attached = sub
        ? (await db.select({ n: count() }).from(taskFiles).where(eq(taskFiles.submissionId, sub.id)))[0]?.n
        : 0;
      if (!attached) throw badRequest("Escribe tu respuesta o sube un archivo antes de entregar");
    }
    const draft = await draftFor(task, studentId, sub);
    await db
      .update(taskSubmissions)
      .set({
        text: input.text,
        submittedAt: input.turnIn ? now : null,
        submittedByUserId: input.turnIn ? request.auth.userId : null,
        submittedByName: input.turnIn ? request.auth.name : null,
        late: input.turnIn && now > task.dueAt,
        updatedAt: now,
      })
      .where(eq(taskSubmissions.id, draft.id));
    return mySubmission(task, studentId, now);
  });

  /** Subir un archivo a la entrega (mientras no esté entregada: si ya se entregó, primero se anula). */
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, payload, done) => done(null, payload));

    scope.post("/class-tasks/:id/submission/files", readers, async (request, reply) => {
      const { id } = parseOrThrow(idParams, request.params);
      const { alumno } = parseOrThrow(studentQuery, request.query);
      const { task, studentId, sub } = await openSubmission(request, id, alumno).catch((err) => {
        request.raw.resume();
        throw err;
      });
      if (sub?.submittedAt) {
        request.raw.resume();
        throw conflict("Ya entregaste: anula la entrega para agregar archivos");
      }
      const draft = await draftFor(task, studentId, sub);
      const [already] = await db
        .select({ n: count() })
        .from(taskFiles)
        .where(eq(taskFiles.submissionId, draft.id));
      if ((already?.n ?? 0) >= SUBMISSION_FILES_MAX) {
        request.raw.resume();
        throw conflict(`Una entrega lleva hasta ${SUBMISSION_FILES_MAX} archivos`);
      }
      const stored = await storeUpload(request, files, {
        folder: `aula/${task.schoolId}/entregas`,
        max: SUBMISSION_FILE_MAX_BYTES,
      });
      try {
        const [row] = await db
          .insert(taskFiles)
          .values({
            schoolId: task.schoolId,
            taskId: task.id,
            submissionId: draft.id,
            fileName: stored.fileName,
            contentType: stored.contentType,
            sizeBytes: stored.size,
            storageKey: stored.key,
            uploadedByUserId: request.auth.userId,
          })
          .returning();
        return reply.status(201).send({ id: row?.id, name: stored.fileName });
      } catch (err) {
        await files.delete(stored.key).catch(() => {});
        throw err;
      }
    });

    /** Archivo que el maestro adjunta a la tarea (una guía, una hoja de trabajo). */
    scope.post("/class-tasks/:id/files", readers, async (request, reply) => {
      const { id } = parseOrThrow(idParams, request.params);
      const { task } = await editableTask(request, id).catch((err) => {
        request.raw.resume();
        throw err;
      });
      const stored = await storeUpload(request, files, {
        folder: `aula/${task.schoolId}/tareas`,
        max: CLASS_FILE_MAX_BYTES,
      });
      try {
        const [row] = await db
          .insert(taskFiles)
          .values({
            schoolId: task.schoolId,
            taskId: task.id,
            fileName: stored.fileName,
            contentType: stored.contentType,
            sizeBytes: stored.size,
            storageKey: stored.key,
            uploadedByUserId: request.auth.userId,
          })
          .returning();
        return reply.status(201).send({ id: row?.id, name: stored.fileName });
      } catch (err) {
        await files.delete(stored.key).catch(() => {});
        throw err;
      }
    });
  });

  async function fileContext(request: FastifyRequest, id: string) {
    const [file] = await db
      .select()
      .from(taskFiles)
      .where(and(eq(taskFiles.schoolId, tenantOf(request)), eq(taskFiles.id, id)));
    if (!file) throw notFound("Archivo no encontrado");
    const { task, access } = await taskContext(request, file.taskId);
    const [submission] = file.submissionId
      ? await db.select().from(taskSubmissions).where(eq(taskSubmissions.id, file.submissionId))
      : [];
    return { file, task, access, submission };
  }

  /** Los adjuntos de la tarea los ve toda la clase; una entrega, solo su alumno, su familia y el personal. */
  app.get("/task-files/:id/file", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { file, access, submission } = await fileContext(request, id);
    const portal = access.viewer === "alumno" || access.viewer === "familia";
    if (submission && portal && !access.studentIds.includes(submission.studentId)) {
      throw notFound("Archivo no encontrado");
    }
    const range = parseRange(request.headers.range, file.sizeBytes);
    if (range === "invalid") {
      return reply.status(416).header("content-range", `bytes */${file.sizeBytes}`).send();
    }
    const stream = await files.get(file.storageKey, range ?? undefined);
    const inline = file.contentType === "application/pdf" || file.contentType.startsWith("image/");
    reply
      .header("content-type", file.contentType)
      .header("content-disposition", contentDispositionFor(inline, file.fileName))
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, max-age=86400, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox");
    if (range) {
      reply
        .status(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${file.sizeBytes}`)
        .header("content-length", String(range.end - range.start + 1));
    } else {
      reply.header("content-length", String(file.sizeBytes));
    }
    return reply.send(stream);
  });

  /**
   * Quitar un archivo: el maestro, los adjuntos de la tarea; el alumno o su familia, los de su entrega
   * mientras no la haya entregado.
   */
  app.delete("/task-files/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { file, access, submission } = await fileContext(request, id);
    if (!submission) {
      if (!access.canEdit) throw notFound("Archivo no encontrado");
    } else {
      const portal = access.viewer === "alumno" || access.viewer === "familia";
      if (!portal || !access.studentIds.includes(submission.studentId))
        throw notFound("Archivo no encontrado");
      if (submission.submittedAt) throw conflict("Ya entregaste: anula la entrega para quitar archivos");
      if (submission.gradedAt) throw conflict("Esta tarea ya está calificada");
    }
    await db.delete(taskFiles).where(eq(taskFiles.id, id));
    await files.delete(file.storageKey).catch(() => {});
    return reply.status(204).send();
  });
}

/** Las tareas de una clase para su página: el maestro ve cuántos entregaron; el alumno, cómo va. */
export async function classTasksFor(
  db: DbOrTx,
  schoolId: string,
  access: ClassAccess,
): Promise<ClassTaskDto[]> {
  const now = new Date();
  const portal = access.viewer === "alumno" || access.viewer === "familia";
  const rows = (
    await db.select().from(classTasks).where(eq(classTasks.assignmentId, access.assignment.id))
  ).filter((t) => !portal || taskVisibility(t, now) === "publicada");
  const upcoming = rows.filter((t) => t.dueAt >= now).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const past = rows.filter((t) => t.dueAt < now).sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
  return taskDtos(db, [...upcoming, ...past], {
    now,
    rosterSize: portal ? undefined : (await rosterOf(db, schoolId, [access.assignment.sectionId])).length,
    studentId: portal ? access.studentIds[0] : undefined,
  });
}
