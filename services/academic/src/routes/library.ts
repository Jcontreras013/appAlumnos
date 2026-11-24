import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  ApiError,
  badRequest,
  checkedStream,
  contentDispositionFor,
  forbidden,
  notFound,
  parseOrThrow,
  parseRange,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  cleanFileName,
  formatFileSize,
  LIBRARY_FILE_TYPES,
  LIBRARY_MAX_BYTES,
  type LibraryItemDto,
  libraryFileMetaSchema,
  libraryLinkInputSchema,
  libraryTypeOf,
} from "@escolar/shared";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import { enrollments, grades, type LibraryItem, libraryItems, sections, subjects } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { childrenOf } from "../lib/family";
import { findCurrentYear } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  grado: z.uuid().optional(),
  materia: z.uuid().optional(),
});
/** Los datos del archivo van en la dirección (el cuerpo es el archivo): ?titulo=&descripcion=&grado=&materia=&para= */
const uploadQuery = z.object({
  titulo: z.string().optional(),
  descripcion: z.string().optional(),
  grado: z.string().optional(),
  materia: z.string().optional(),
  para: z.string().optional(),
});

const STAFF = ["admin", "coordinador", "secretaria", "docente"] as const;
/** Además de quien lo subió, la dirección y la coordinación pueden quitar cualquier material. */
const MANAGERS = ["admin", "coordinador"];

/** Grados en los que están matriculados los hijos de la familia este año. */
async function familyGrades(db: DbOrTx, schoolId: string, userId: string): Promise<string[]> {
  const kids = await childrenOf(db, schoolId, userId);
  const year = await findCurrentYear(db, schoolId);
  if (!kids.length || !year) return [];
  const rows = await db
    .selectDistinct({ gradeId: sections.gradeId })
    .from(enrollments)
    .innerJoin(sections, eq(sections.id, enrollments.sectionId))
    .where(
      and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.schoolYearId, year.id),
        eq(enrollments.status, "activa"),
        inArray(enrollments.studentId, kids),
      ),
    );
  return rows.map((r) => r.gradeId);
}

/**
 * Biblioteca virtual: el personal sube libros, guías y enlaces por grado y materia; las familias ven
 * lo compartido con ellas para los grados de sus hijos. Los archivos se revisan al subir (tienen que
 * ser lo que dicen ser) y se entregan solo a quien los puede ver, por tramos (así el lector de PDF abre
 * un libro grande sin bajarlo completo).
 */
export async function libraryRoutes(app: FastifyInstance, { db, files }: AcademicDeps) {
  const readers = { preHandler: [app.authenticate, requireRole(...STAFF, "padre")] };
  const staff = { preHandler: [app.authenticate, requireRole(...STAFF)] };

  async function toDtos(rows: LibraryItem[], request: FastifyRequest): Promise<LibraryItemDto[]> {
    const schoolId = tenantOf(request);
    const gradeIds = [...new Set(rows.map((r) => r.gradeId).filter((g): g is string => g !== null))];
    const subjectIds = [...new Set(rows.map((r) => r.subjectId).filter((s): s is string => s !== null))];
    const [gradeRows, subjectRows] = await Promise.all([
      gradeIds.length
        ? db
            .select({ id: grades.id, name: grades.name })
            .from(grades)
            .where(and(eq(grades.schoolId, schoolId), inArray(grades.id, gradeIds)))
        : [],
      subjectIds.length
        ? db
            .select({ id: subjects.id, name: subjects.name })
            .from(subjects)
            .where(and(eq(subjects.schoolId, schoolId), inArray(subjects.id, subjectIds)))
        : [],
    ]);
    const manager = MANAGERS.includes(request.auth.role);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      url: r.kind === "enlace" ? r.url : null,
      file:
        r.kind === "archivo" && r.fileName && r.contentType && r.sizeBytes
          ? { name: r.fileName, contentType: r.contentType, size: r.sizeBytes }
          : null,
      gradeId: r.gradeId,
      gradeName: gradeRows.find((g) => g.id === r.gradeId)?.name ?? null,
      subjectId: r.subjectId,
      subjectName: subjectRows.find((s) => s.id === r.subjectId)?.name ?? null,
      audience: r.audience,
      uploadedByName: r.uploadedByName,
      createdAt: r.createdAt.toISOString(),
      canDelete: request.auth.role !== "padre" && (manager || r.uploadedByUserId === request.auth.userId),
    }));
  }

  /** Lo que esta persona puede ver de la biblioteca (el personal, todo; las familias, lo suyo). */
  async function visibleFilter(request: FastifyRequest) {
    const schoolId = tenantOf(request);
    if (request.auth.role !== "padre") return eq(libraryItems.schoolId, schoolId);
    const gradeIds = await familyGrades(db, schoolId, request.auth.userId);
    return and(
      eq(libraryItems.schoolId, schoolId),
      eq(libraryItems.audience, "familias"),
      gradeIds.length
        ? or(isNull(libraryItems.gradeId), inArray(libraryItems.gradeId, gradeIds))
        : isNull(libraryItems.gradeId),
    );
  }

  /** El grado y la materia tienen que ser del centro. */
  async function checkPlacement(schoolId: string, gradeId?: string, subjectId?: string) {
    if (gradeId) {
      const [g] = await db
        .select({ id: grades.id })
        .from(grades)
        .where(and(eq(grades.schoolId, schoolId), eq(grades.id, gradeId)));
      if (!g) throw badRequest("Ese grado no existe en el centro");
    }
    if (subjectId) {
      const [s] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, subjectId)));
      if (!s) throw badRequest("Esa materia no existe en el centro");
    }
  }

  app.get("/library", readers, async (request): Promise<LibraryItemDto[]> => {
    const { grado, materia } = parseOrThrow(listQuery, request.query);
    const rows = await db
      .select()
      .from(libraryItems)
      .where(
        and(
          await visibleFilter(request),
          grado ? eq(libraryItems.gradeId, grado) : undefined,
          materia ? eq(libraryItems.subjectId, materia) : undefined,
        ),
      )
      .orderBy(desc(libraryItems.createdAt))
      .limit(1000);
    return toDtos(rows, request);
  });

  app.get("/library/:id", readers, async (request): Promise<LibraryItemDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(libraryItems)
      .where(and(eq(libraryItems.id, id), await visibleFilter(request)));
    if (!row) throw notFound("Material no encontrado");
    const [dto] = await toDtos([row], request);
    if (!dto) throw notFound("Material no encontrado");
    return dto;
  });

  app.post("/library/links", staff, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(libraryLinkInputSchema, request.body);
    await checkPlacement(schoolId, input.gradeId, input.subjectId);
    const [row] = await db
      .insert(libraryItems)
      .values({
        schoolId,
        kind: "enlace",
        title: input.title,
        description: input.description ?? null,
        url: input.url,
        gradeId: input.gradeId ?? null,
        subjectId: input.subjectId ?? null,
        audience: input.audience,
        uploadedByUserId: request.auth.userId,
        uploadedByName: request.auth.name,
      })
      .returning();
    if (!row) throw new Error("No se guardó el enlace");
    const [dto] = await toDtos([row], request);
    return reply.status(201).send(dto);
  });

  /** Subir un archivo: el cuerpo es el archivo tal cual; se revisa mientras llega y se guarda sin pasar por memoria. */
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, payload, done) => done(null, payload));
    scope.post("/library/files", staff, async (request, reply) => {
      const schoolId = tenantOf(request);
      const q = parseOrThrow(uploadQuery, request.query);
      const meta = parseOrThrow(libraryFileMetaSchema, {
        title: q.titulo,
        description: q.descripcion,
        gradeId: q.grado,
        subjectId: q.materia,
        audience: q.para,
      });
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
      const contentType = libraryTypeOf(rawName, declared);
      const type = contentType ? LIBRARY_FILE_TYPES[contentType] : undefined;
      if (!contentType || !type) {
        request.raw.resume();
        throw new ApiError(415, "unsupported_media", "La biblioteca acepta PDF, Word, Excel y PowerPoint.");
      }
      const size = Number(request.headers["content-length"]);
      if (!Number.isInteger(size) || size <= 0)
        throw new ApiError(411, "length_required", "Falta el tamaño del archivo");
      const tooLarge = () =>
        new ApiError(
          413,
          "too_large",
          `El archivo pesa demasiado: el máximo es ${formatFileSize(LIBRARY_MAX_BYTES)}.`,
        );
      if (size > LIBRARY_MAX_BYTES) {
        request.raw.resume();
        throw tooLarge();
      }
      await checkPlacement(schoolId, meta.gradeId, meta.subjectId);
      const key = `biblioteca/${schoolId}/${randomUUID()}.${type.ext}`;
      await files.put(
        key,
        checkedStream(request.body as Readable, {
          contentType,
          declaredSize: size,
          max: LIBRARY_MAX_BYTES,
          tooLarge,
        }),
        size,
        contentType,
      );
      try {
        const [row] = await db
          .insert(libraryItems)
          .values({
            schoolId,
            kind: "archivo",
            title: meta.title,
            description: meta.description ?? null,
            fileName: cleanFileName(rawName, type.ext),
            contentType,
            sizeBytes: size,
            storageKey: key,
            gradeId: meta.gradeId ?? null,
            subjectId: meta.subjectId ?? null,
            audience: meta.audience,
            uploadedByUserId: request.auth.userId,
            uploadedByName: request.auth.name,
          })
          .returning();
        if (!row) throw new Error("No se guardó el material");
        const [dto] = await toDtos([row], request);
        return reply.status(201).send(dto);
      } catch (err) {
        await files.delete(key).catch(() => {});
        throw err;
      }
    });
  });

  /** Entrega el archivo a quien lo puede ver. El PDF se muestra (lo abre el lector); el resto se descarga. */
  app.get("/library/:id/file", readers, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(libraryItems)
      .where(and(eq(libraryItems.id, id), await visibleFilter(request)));
    if (row?.kind !== "archivo" || !row.storageKey || !row.sizeBytes || !row.contentType) {
      throw notFound("Material no encontrado");
    }
    const range = parseRange(request.headers.range, row.sizeBytes);
    if (range === "invalid") {
      return reply.status(416).header("content-range", `bytes */${row.sizeBytes}`).send();
    }
    const stream = await files.get(row.storageKey, range ?? undefined);
    reply
      .header("content-type", row.contentType)
      .header(
        "content-disposition",
        contentDispositionFor(row.contentType === "application/pdf", row.fileName ?? "documento"),
      )
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, max-age=86400, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox");
    if (range) {
      reply
        .status(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${row.sizeBytes}`)
        .header("content-length", String(range.end - range.start + 1));
    } else {
      reply.header("content-length", String(row.sizeBytes));
    }
    return reply.send(stream);
  });

  app.delete("/library/:id", staff, async (request, reply) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(libraryItems)
      .where(and(eq(libraryItems.schoolId, schoolId), eq(libraryItems.id, id)));
    if (!row) throw notFound("Material no encontrado");
    if (!MANAGERS.includes(request.auth.role) && row.uploadedByUserId !== request.auth.userId) {
      throw forbidden("Solo quien lo subió, la dirección o la coordinación pueden quitarlo");
    }
    await db.transaction(async (tx) => {
      await tx.delete(libraryItems).where(eq(libraryItems.id, id));
      await audit(tx, request, {
        action: "library.removed",
        entityType: "library_item",
        entityId: id,
        data: { title: row.title },
      });
    });
    if (row.storageKey) await files.delete(row.storageKey).catch(() => {});
    return reply.status(204).send();
  });
}
