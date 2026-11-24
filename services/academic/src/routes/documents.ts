import { conflict, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  createDocumentInputSchema,
  type DocumentDto,
  type DocumentSummaryDto,
  EMPTY_DOCUMENT,
  saveDocumentInputSchema,
} from "@escolar/shared";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { documents, type SchoolDocument } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";

const idParams = z.object({ id: z.uuid() });

const summary = (d: SchoolDocument, me: string): DocumentSummaryDto => ({
  id: d.id,
  title: d.title,
  template: d.template,
  visibility: d.visibility,
  authorName: d.authorName,
  mine: d.authorUserId === me,
  updatedAt: d.updatedAt.toISOString(),
});

const full = (d: SchoolDocument, me: string): DocumentDto => ({
  ...summary(d, me),
  content: d.content,
  version: d.version,
  canEdit: d.authorUserId === me,
});

/**
 * Documentos del centro: cada quien escribe los suyos (circulares, actas, informes…) y decide si los
 * ve todo el personal. Solo quien lo escribe lo cambia o lo borra; nadie ve los privados de otro.
 */
export async function documentRoutes(app: FastifyInstance, { db }: AcademicDeps) {
  const staff = {
    preHandler: [app.authenticate, requireRole("admin", "coordinador", "secretaria", "docente")],
  };

  /** El documento si quien lo pide lo puede ver (suyo o compartido con el personal). */
  async function visible(request: FastifyRequest, id: string) {
    const [row] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.schoolId, tenantOf(request)),
          eq(documents.id, id),
          or(eq(documents.authorUserId, request.auth.userId), eq(documents.visibility, "personal")),
        ),
      );
    if (!row) throw notFound("Documento no encontrado");
    return row;
  }

  app.get("/documents", staff, async (request): Promise<DocumentSummaryDto[]> => {
    const me = request.auth.userId;
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.schoolId, tenantOf(request)),
          or(eq(documents.authorUserId, me), eq(documents.visibility, "personal")),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(500);
    return rows.map((d) => summary(d, me));
  });

  app.post("/documents", staff, async (request, reply) => {
    const input = parseOrThrow(createDocumentInputSchema, request.body);
    const [row] = await db
      .insert(documents)
      .values({
        schoolId: tenantOf(request),
        title: input.title,
        template: input.template,
        content: input.content ?? EMPTY_DOCUMENT,
        visibility: input.visibility,
        authorUserId: request.auth.userId,
        authorName: request.auth.name,
      })
      .returning();
    if (!row) throw new Error("No se creó el documento");
    return reply.status(201).send(full(row, request.auth.userId));
  });

  app.get("/documents/:id", staff, async (request): Promise<DocumentDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return full(await visible(request, id), request.auth.userId);
  });

  app.put("/documents/:id", staff, async (request): Promise<DocumentDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const input = parseOrThrow(saveDocumentInputSchema, request.body);
    const current = await visible(request, id);
    if (current.authorUserId !== request.auth.userId) {
      throw notFound("Documento no encontrado");
    }
    const [row] = await db
      .update(documents)
      .set({
        title: input.title,
        content: input.content,
        visibility: input.visibility,
        version: sql`${documents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.version, input.version)))
      .returning();
    if (!row) {
      throw conflict(
        "Este documento se guardó desde otra ventana. Copia lo que escribiste y recarga la página para ver lo último.",
      );
    }
    return full(row, request.auth.userId);
  });

  app.delete("/documents/:id", staff, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const current = await visible(request, id);
    if (current.authorUserId !== request.auth.userId) {
      throw notFound("Documento no encontrado");
    }
    await db.transaction(async (tx) => {
      await tx.delete(documents).where(eq(documents.id, id));
      await audit(tx, request, {
        action: "document.deleted",
        entityType: "document",
        entityId: id,
        data: { title: current.title },
      });
    });
    return reply.status(204).send();
  });
}
