import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  ApiError,
  badRequest,
  checkedStream,
  contentDispositionFor,
  notFound,
  parseOrThrow,
  parseRange,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  type AssignmentDto,
  CLASS_FILE_MAX_BYTES,
  CLASS_FILE_TYPES,
  type ClassMaterialDto,
  type ClassPostDto,
  type ClassroomDto,
  type ClassSummaryDto,
  classFileTypeOf,
  classLinkInputSchema,
  classPostInputSchema,
  classSettingsInputSchema,
  classTopicOrderSchema,
  cleanFileName,
  formatFileSize,
  youtubeId,
} from "@escolar/shared";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { type ClassMaterial, type ClassPost, classMaterials, classPosts, virtualClasses } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { classAccess, classesOfStudent } from "../lib/classroom";
import { teacherClasses } from "../lib/evaluation";
import { childrenOf, studentOf } from "../lib/family";
import { findCurrentYear, listAssignments } from "../lib/queries";
import { classQuizzesFor } from "./quizzes";
import { classTasksFor } from "./tasks";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  /** Familia: de cuál hijo. */
  alumno: z.uuid().optional(),
  /** Oficina: todas las clases del año (si no, las que da quien pregunta). */
  todas: z.enum(["1"]).optional(),
});
const fileQuery = z.object({ titulo: z.string().max(150).optional() });

const READERS = ["admin", "coordinador", "secretaria", "docente", "padre", "estudiante"] as const;
const OFFICE = ["admin", "coordinador", "secretaria"];

function toMaterialDto(m: ClassMaterial): ClassMaterialDto {
  return {
    id: m.id,
    kind: m.kind,
    title: m.title,
    url: m.kind === "archivo" ? null : m.url,
    youtubeId: m.kind === "video" && m.url ? youtubeId(m.url) : null,
    file:
      m.kind === "archivo" && m.fileName && m.contentType && m.sizeBytes
        ? { name: m.fileName, contentType: m.contentType, size: m.sizeBytes }
        : null,
    createdAt: m.createdAt.toISOString(),
  };
}

async function postDtos(db: DbOrTx, posts: ClassPost[]): Promise<ClassPostDto[]> {
  const materials = posts.length
    ? await db
        .select()
        .from(classMaterials)
        .where(
          inArray(
            classMaterials.postId,
            posts.map((p) => p.id),
          ),
        )
        .orderBy(asc(classMaterials.createdAt))
    : [];
  return posts.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    body: p.body,
    authorName: p.authorName,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    materials: materials.filter((m) => m.postId === p.id).map(toMaterialDto),
  }));
}

/** Resumen de cada clase: enlace de la clase en línea y cuántos temas tiene. */
async function summaries(
  db: DbOrTx,
  list: Array<{ assignment: AssignmentDto; substituting: boolean }>,
): Promise<ClassSummaryDto[]> {
  const ids = list.map((c) => c.assignment.id);
  const [settings, topicCounts] = ids.length
    ? await Promise.all([
        db.select().from(virtualClasses).where(inArray(virtualClasses.assignmentId, ids)),
        db
          .select({ assignmentId: classPosts.assignmentId, n: count() })
          .from(classPosts)
          .where(and(inArray(classPosts.assignmentId, ids), eq(classPosts.kind, "tema")))
          .groupBy(classPosts.assignmentId),
      ])
    : [[], []];
  return list.map(({ assignment: a, substituting }) => {
    const s = settings.find((x) => x.assignmentId === a.id);
    return {
      assignmentId: a.id,
      subjectName: a.subjectName,
      sectionId: a.sectionId,
      sectionLabel: a.sectionLabel,
      teacherName: a.teacherName,
      meetingUrl: s?.meetingUrl ?? null,
      meetingNote: s?.meetingNote ?? null,
      topics: topicCounts.find((t) => t.assignmentId === a.id)?.n ?? 0,
      substituting,
    };
  });
}

/**
 * Aula virtual de cada clase: temas con su explicación y materiales, avisos y el enlace de la clase
 * en línea. El maestro (o su sustituto), la dirección y la coordinación publican; los alumnos de la
 * sección y sus familias ven. Los archivos se revisan al subir y se entregan solo a quien ve la clase.
 */
export async function classroomRoutes(app: FastifyInstance, { db, files, today }: AcademicDeps) {
  const readers = { preHandler: [app.authenticate, requireRole(...READERS)] };

  /** La clase del recurso pedido, si quien pregunta la puede editar. */
  async function editable(request: FastifyRequest, assignmentId: string) {
    const access = await classAccess(db, request.auth, assignmentId, today());
    if (!access.canEdit) throw notFound("Clase no encontrada");
    return access;
  }

  async function postOrThrow(request: FastifyRequest, id: string) {
    const [post] = await db
      .select()
      .from(classPosts)
      .where(and(eq(classPosts.schoolId, tenantOf(request)), eq(classPosts.id, id)));
    if (!post) throw notFound("Publicación no encontrada");
    return post;
  }

  // ── Mis clases ──
  app.get("/classes", readers, async (request): Promise<ClassSummaryDto[]> => {
    const schoolId = tenantOf(request);
    const { alumno, todas } = parseOrThrow(listQuery, request.query);
    const { role, userId } = request.auth;
    if (role === "estudiante" || role === "padre") {
      const studentId = role === "estudiante" ? await studentOf(db, schoolId, userId) : alumno;
      if (!studentId) return [];
      if (role === "padre" && !(await childrenOf(db, schoolId, userId)).includes(studentId))
        throw notFound("Alumno no encontrado");
      const classes = await classesOfStudent(db, schoolId, studentId);
      return summaries(
        db,
        classes.map((assignment) => ({ assignment, substituting: false })),
      );
    }
    if (todas && OFFICE.includes(role)) {
      const year = await findCurrentYear(db, schoolId);
      const all = year ? await listAssignments(db, schoolId, { schoolYearId: year.id }) : [];
      return summaries(
        db,
        all.map((assignment) => ({ assignment, substituting: false })),
      );
    }
    if (role === "secretaria") return [];
    return summaries(db, await teacherClasses(db, schoolId, userId, today()));
  });

  app.get("/classes/:id", readers, async (request): Promise<ClassroomDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const access = await classAccess(db, request.auth, id, today());
    const { assignment, viewer, canEdit } = access;
    const [settings] = await db.select().from(virtualClasses).where(eq(virtualClasses.assignmentId, id));
    const [topics, announcements] = await Promise.all([
      db
        .select()
        .from(classPosts)
        .where(and(eq(classPosts.assignmentId, id), eq(classPosts.kind, "tema")))
        .orderBy(asc(classPosts.position), asc(classPosts.createdAt)),
      db
        .select()
        .from(classPosts)
        .where(and(eq(classPosts.assignmentId, id), eq(classPosts.kind, "aviso")))
        .orderBy(desc(classPosts.createdAt))
        .limit(50),
    ]);
    return {
      assignmentId: assignment.id,
      subjectName: assignment.subjectName,
      sectionId: assignment.sectionId,
      sectionLabel: assignment.sectionLabel,
      teacherName: assignment.teacherName,
      meetingUrl: settings?.meetingUrl ?? null,
      meetingNote: settings?.meetingNote ?? null,
      viewer,
      canEdit,
      topics: await postDtos(db, topics),
      announcements: await postDtos(db, announcements),
      tasks: await classTasksFor(db, tenantOf(request), access),
      quizzes: await classQuizzesFor(db, tenantOf(request), access),
    };
  });

  /** Enlace de la clase en línea (Meet, Zoom, Jitsi) y cuándo es. */
  app.put("/classes/:id/settings", readers, async (request) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await editable(request, id);
    const input = parseOrThrow(classSettingsInputSchema, request.body);
    const values = {
      meetingUrl: input.meetingUrl ?? null,
      meetingNote: input.meetingNote ?? null,
      updatedByUserId: request.auth.userId,
      updatedAt: new Date(),
    };
    await db
      .insert(virtualClasses)
      .values({ schoolId, assignmentId: id, ...values })
      .onConflictDoUpdate({ target: virtualClasses.assignmentId, set: values });
    return { meetingUrl: values.meetingUrl, meetingNote: values.meetingNote };
  });

  // ── Temas y avisos ──
  app.post("/classes/:id/posts", readers, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await editable(request, id);
    const input = parseOrThrow(classPostInputSchema, request.body);
    // Un tema nuevo va al final de la lista.
    const [last] = await db
      .select({ position: max(classPosts.position) })
      .from(classPosts)
      .where(and(eq(classPosts.assignmentId, id), eq(classPosts.kind, "tema")));
    const [post] = await db
      .insert(classPosts)
      .values({
        schoolId,
        assignmentId: id,
        kind: input.kind,
        title: input.title,
        body: input.body,
        position: input.kind === "tema" ? (last?.position ?? 0) + 1 : 0,
        authorUserId: request.auth.userId,
        authorName: request.auth.name,
      })
      .returning();
    if (!post) throw new Error("No se guardó la publicación");
    const [dto] = await postDtos(db, [post]);
    return reply.status(201).send(dto);
  });

  app.put("/class-posts/:id", readers, async (request): Promise<ClassPostDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const post = await postOrThrow(request, id);
    await editable(request, post.assignmentId);
    const input = parseOrThrow(classPostInputSchema, request.body);
    if (input.kind !== post.kind) throw badRequest("Un tema no se puede volver aviso (ni al revés)");
    const [updated] = await db
      .update(classPosts)
      .set({ title: input.title, body: input.body, updatedAt: new Date() })
      .where(eq(classPosts.id, id))
      .returning();
    const [dto] = await postDtos(db, updated ? [updated] : []);
    if (!dto) throw notFound("Publicación no encontrada");
    return dto;
  });

  app.delete("/class-posts/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const post = await postOrThrow(request, id);
    await editable(request, post.assignmentId);
    const stored = await db
      .select({ key: classMaterials.storageKey })
      .from(classMaterials)
      .where(eq(classMaterials.postId, id));
    await db.transaction(async (tx) => {
      await tx.delete(classPosts).where(eq(classPosts.id, id));
      await audit(tx, request, {
        action: "class_post.deleted",
        entityType: "class_post",
        entityId: id,
        data: { title: post.title, kind: post.kind, assignmentId: post.assignmentId },
      });
    });
    for (const { key } of stored) if (key) await files.delete(key).catch(() => {});
    return reply.status(204).send();
  });

  /** El orden de los temas, de arriba abajo. */
  app.put("/classes/:id/topics/order", readers, async (request) => {
    const { id } = parseOrThrow(idParams, request.params);
    await editable(request, id);
    const { ids } = parseOrThrow(classTopicOrderSchema, request.body);
    const topics = await db
      .select({ id: classPosts.id })
      .from(classPosts)
      .where(and(eq(classPosts.assignmentId, id), eq(classPosts.kind, "tema")));
    const known = new Set(topics.map((t) => t.id));
    if (ids.length !== known.size || ids.some((t) => !known.has(t)))
      throw badRequest("La lista no coincide con los temas de la clase");
    await db.transaction(async (tx) => {
      for (const [index, topicId] of ids.entries()) {
        await tx
          .update(classPosts)
          .set({ position: index + 1 })
          .where(eq(classPosts.id, topicId));
      }
    });
    return { ok: true };
  });

  // ── Materiales de un tema ──
  app.post("/class-posts/:id/links", readers, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const post = await postOrThrow(request, id);
    await editable(request, post.assignmentId);
    const input = parseOrThrow(classLinkInputSchema, request.body);
    const video = youtubeId(input.url) !== null;
    const [material] = await db
      .insert(classMaterials)
      .values({
        schoolId,
        assignmentId: post.assignmentId,
        postId: post.id,
        kind: video ? "video" : "enlace",
        title: input.title ?? (video ? "Video" : new URL(input.url).hostname.replace(/^www\./, "")),
        url: input.url,
        createdByUserId: request.auth.userId,
      })
      .returning();
    if (!material) throw new Error("No se guardó el enlace");
    return reply.status(201).send(toMaterialDto(material));
  });

  /** Subir un archivo a un tema: el cuerpo es el archivo; se revisa mientras llega. */
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, payload, done) => done(null, payload));
    scope.post("/class-posts/:id/files", readers, async (request, reply) => {
      const schoolId = tenantOf(request);
      const { id } = parseOrThrow(idParams, request.params);
      const { titulo } = parseOrThrow(fileQuery, request.query);
      const post = await postOrThrow(request, id);
      await editable(request, post.assignmentId);
      let rawName = "";
      try {
        rawName = decodeURIComponent(String(request.headers["x-file-name"] ?? ""));
      } catch {
        throw badRequest("Nombre de archivo inválido");
      }
      const declared =
        String(request.headers["content-type"] ?? "")
          .split(";")[0]
          ?.trim() ?? "";
      const contentType = classFileTypeOf(rawName, declared);
      const type = contentType ? CLASS_FILE_TYPES[contentType] : undefined;
      if (!contentType || !type) {
        request.raw.resume();
        throw new ApiError(
          415,
          "unsupported_media",
          "Se aceptan PDF, Word, Excel, PowerPoint e imágenes. Los videos, por enlace de YouTube.",
        );
      }
      const size = Number(request.headers["content-length"]);
      if (!Number.isInteger(size) || size <= 0)
        throw new ApiError(411, "length_required", "Falta el tamaño del archivo");
      const tooLarge = () =>
        new ApiError(
          413,
          "too_large",
          `El archivo pesa demasiado: el máximo es ${formatFileSize(CLASS_FILE_MAX_BYTES)}.`,
        );
      if (size > CLASS_FILE_MAX_BYTES) {
        request.raw.resume();
        throw tooLarge();
      }
      const key = `aula/${schoolId}/${randomUUID()}.${type.ext}`;
      await files.put(
        key,
        checkedStream(request.body as Readable, {
          contentType,
          declaredSize: size,
          max: CLASS_FILE_MAX_BYTES,
          tooLarge,
        }),
        size,
        contentType,
      );
      try {
        const fileName = cleanFileName(rawName, type.ext);
        const [material] = await db
          .insert(classMaterials)
          .values({
            schoolId,
            assignmentId: post.assignmentId,
            postId: post.id,
            kind: "archivo",
            title: titulo?.trim() || fileName.replace(/\.[^.]+$/, ""),
            fileName,
            contentType,
            sizeBytes: size,
            storageKey: key,
            createdByUserId: request.auth.userId,
          })
          .returning();
        if (!material) throw new Error("No se guardó el archivo");
        return reply.status(201).send(toMaterialDto(material));
      } catch (err) {
        await files.delete(key).catch(() => {});
        throw err;
      }
    });
  });

  async function materialOrThrow(request: FastifyRequest, id: string) {
    const [material] = await db
      .select()
      .from(classMaterials)
      .where(and(eq(classMaterials.schoolId, tenantOf(request)), eq(classMaterials.id, id)));
    if (!material) throw notFound("Material no encontrado");
    return material;
  }

  /** Entrega el archivo a quien ve la clase. El PDF y las imágenes se muestran; el resto se descarga. */
  app.get("/class-materials/:id/file", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const material = await materialOrThrow(request, id);
    await classAccess(db, request.auth, material.assignmentId, today());
    if (material.kind !== "archivo" || !material.storageKey || !material.sizeBytes || !material.contentType) {
      throw notFound("Material no encontrado");
    }
    const range = parseRange(request.headers.range, material.sizeBytes);
    if (range === "invalid") {
      return reply.status(416).header("content-range", `bytes */${material.sizeBytes}`).send();
    }
    const stream = await files.get(material.storageKey, range ?? undefined);
    const inline = material.contentType === "application/pdf" || material.contentType.startsWith("image/");
    reply
      .header("content-type", material.contentType)
      .header("content-disposition", contentDispositionFor(inline, material.fileName ?? "documento"))
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, max-age=86400, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox");
    if (range) {
      reply
        .status(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${material.sizeBytes}`)
        .header("content-length", String(range.end - range.start + 1));
    } else {
      reply.header("content-length", String(material.sizeBytes));
    }
    return reply.send(stream);
  });

  app.delete("/class-materials/:id", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const material = await materialOrThrow(request, id);
    await editable(request, material.assignmentId);
    await db.delete(classMaterials).where(eq(classMaterials.id, id));
    if (material.storageKey) await files.delete(material.storageKey).catch(() => {});
    return reply.status(204).send();
  });
}
