import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  type AttachmentDto,
  type AttachmentKind,
  attachmentTypeOf,
  type ConversationDto,
  type ConversationPersonDto,
  type ConversationSummaryDto,
  cleanFileName,
  MESSAGING_ROLES,
  type MessageContactDto,
  type MessageDto,
  messageInputSchema,
  type PushKeyDto,
  pushDeviceSchema,
  pushDeviceTokenSchema,
  pushEndpointSchema,
  pushSubscriptionSchema,
  startConversationSchema,
  type UnreadMessagesDto,
  withinNotifyHours,
} from "@escolar/shared";
import { and, count, desc, eq, inArray, isNotNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  conversationMembers,
  conversations,
  type Message,
  type MessageAttachment,
  messageAttachments,
  messages,
  pushDevices,
  pushSubscriptions,
  schools,
  users,
} from "../db/schema";
import type { IdentityDeps } from "../deps";
import { checkedUpload, contentDisposition, parseRange } from "../lib/attachments";
import { messagePayload, messagingStaff, pairKeyOf, pushToUsers } from "../lib/messages";

const idParams = z.object({ id: z.uuid() });
const conversationQuery = z.object({
  antes: z.uuid().optional(),
  leer: z.enum(["0", "1"]).optional(),
});
/** Mensajes por página al abrir una conversación (los más recientes). */
const PAGE = 50;
/** Teléfonos con avisos por persona: al pasar el límite se olvida el más viejo. */
const MAX_DEVICES = 10;

/**
 * Mensajes entre el personal del centro (por ahora maestros y dirección). Cada consulta filtra por el
 * centro de la sesión y por las conversaciones de quien pregunta: nadie lee conversaciones ajenas,
 * aunque conozca su id.
 */
export async function messageRoutes(
  app: FastifyInstance,
  { db, push, nativePush, files, now }: IdentityDeps,
) {
  const notifier = { web: push, native: nativePush };
  const canNotify = push !== null || nativePush !== null;
  const guard = { preHandler: [app.authenticate, requireRole(...MESSAGING_ROLES)] };
  const other = alias(conversationMembers, "other");

  /** La conversación con mi lugar en ella y el del otro; 404 si no es mía o es de otro centro. */
  async function load(request: FastifyRequest, id: string) {
    const schoolId = tenantOf(request);
    const me = request.auth.userId;
    const [row] = await db
      .select({
        conversation: conversations,
        myReadAt: conversationMembers.lastReadAt,
        otherUserId: other.userId,
        otherReadAt: other.lastReadAt,
        otherName: users.name,
      })
      .from(conversations)
      .innerJoin(
        conversationMembers,
        and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, me)),
      )
      .innerJoin(other, and(eq(other.conversationId, conversations.id), ne(other.userId, me)))
      .innerJoin(users, eq(users.id, other.userId))
      .where(and(eq(conversations.id, id), eq(conversations.schoolId, schoolId)));
    if (!row) throw notFound("Conversación no encontrada");
    return { schoolId, me, ...row };
  }

  async function person(schoolId: string, userId: string, name: string): Promise<ConversationPersonDto> {
    const staff = await messagingStaff(db, schoolId, [userId]);
    return { userId, name, role: staff.get(userId)?.role ?? null };
  }

  const toAttachmentDto = (a: MessageAttachment): AttachmentDto => ({
    id: a.id,
    kind: a.kind,
    name: a.fileName,
    contentType: a.contentType,
    size: a.sizeBytes,
  });

  const toMessageDto = (
    m: Message,
    me: string,
    otherReadAt: Date | null,
    attachment: MessageAttachment | undefined,
  ): MessageDto => ({
    id: m.id,
    body: m.body,
    sentAt: m.createdAt.toISOString(),
    mine: m.senderUserId === me,
    seen: m.senderUserId === me && otherReadAt !== null && m.createdAt <= otherReadAt,
    attachment: attachment ? toAttachmentDto(attachment) : null,
  });

  /** Los adjuntos de esos mensajes, por mensaje. */
  async function attachmentsOf(messageIds: string[]) {
    if (messageIds.length === 0) return new Map<string, MessageAttachment>();
    const rows = await db
      .select()
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, messageIds));
    return new Map(rows.map((a) => [a.messageId, a]));
  }

  /** Compañeros a los que se les puede escribir. */
  app.get("/messages/contacts", guard, async (request): Promise<MessageContactDto[]> => {
    const staff = await messagingStaff(db, tenantOf(request));
    return [...staff.values()].filter((s) => s.userId !== request.auth.userId);
  });

  /** Mis conversaciones, la más reciente primero, con el último mensaje y cuántos no he leído. */
  app.get("/messages/conversations", guard, async (request): Promise<ConversationSummaryDto[]> => {
    const schoolId = tenantOf(request);
    const me = request.auth.userId;
    const rows = await db
      .select({ id: conversations.id, otherUserId: other.userId, otherName: users.name })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .innerJoin(other, and(eq(other.conversationId, conversations.id), ne(other.userId, me)))
      .innerJoin(users, eq(users.id, other.userId))
      .where(
        and(
          eq(conversationMembers.userId, me),
          eq(conversationMembers.schoolId, schoolId),
          isNotNull(conversations.lastMessageAt),
        ),
      )
      .orderBy(desc(conversations.lastMessageAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [last, unread, staff] = await Promise.all([
      db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(messages.conversationId, desc(messages.createdAt)),
      unreadCounts(schoolId, me, ids),
      messagingStaff(
        db,
        schoolId,
        rows.map((r) => r.otherUserId),
      ),
    ]);
    const lastBy = new Map(last.map((m) => [m.conversationId, m]));
    const lastAttachments = await attachmentsOf(last.map((m) => m.id));
    return rows.map((r) => {
      const m = lastBy.get(r.id);
      const a = m ? lastAttachments.get(m.id) : undefined;
      return {
        id: r.id,
        other: { userId: r.otherUserId, name: r.otherName, role: staff.get(r.otherUserId)?.role ?? null },
        lastMessage: m
          ? {
              body: m.body,
              sentAt: m.createdAt.toISOString(),
              mine: m.senderUserId === me,
              attachment: a ? { kind: a.kind, name: a.fileName } : null,
            }
          : null,
        unread: unread.get(r.id) ?? 0,
      };
    });
  });

  /** Mensajes del otro que no he leído, por conversación. */
  async function unreadCounts(schoolId: string, me: string, ids?: string[]) {
    const rows = await db
      .select({ conversationId: messages.conversationId, n: count() })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, me),
        ),
      )
      .where(
        and(
          eq(conversationMembers.schoolId, schoolId),
          ne(messages.senderUserId, me),
          sql`${messages.createdAt} > coalesce(${conversationMembers.lastReadAt}, '-infinity'::timestamptz)`,
          ids ? inArray(messages.conversationId, ids) : undefined,
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(rows.map((r) => [r.conversationId, r.n]));
  }

  /** Para el menú: cuántas conversaciones tienen algo sin leer. */
  app.get("/messages/unread", guard, async (request): Promise<UnreadMessagesDto> => {
    const unread = await unreadCounts(tenantOf(request), request.auth.userId);
    return { conversations: unread.size };
  });

  /** Abre (o retoma) la conversación con un compañero. Entre dos personas hay una sola. */
  app.post("/messages/conversations", guard, async (request) => {
    const schoolId = tenantOf(request);
    const me = request.auth.userId;
    const { userId } = parseOrThrow(startConversationSchema, request.body);
    if (userId === me) throw badRequest("Elige a otra persona");
    const staff = await messagingStaff(db, schoolId, [me, userId]);
    if (!staff.has(userId)) throw notFound("Esa persona no está entre el personal del centro");
    if (!staff.has(me)) throw conflict("Tu acceso a este centro ya no está activo");
    const pairKey = pairKeyOf(me, userId);
    const id = await db.transaction(async (tx) => {
      await tx.insert(conversations).values({ schoolId, pairKey }).onConflictDoNothing();
      const [row] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.schoolId, schoolId), eq(conversations.pairKey, pairKey)));
      if (!row) throw new Error("No se abrió la conversación");
      await tx
        .insert(conversationMembers)
        .values([
          { conversationId: row.id, userId: me, schoolId },
          { conversationId: row.id, userId, schoolId },
        ])
        .onConflictDoNothing();
      return row.id;
    });
    return { id };
  });

  /**
   * Una conversación: los últimos mensajes (o los anteriores a `antes`). Con `leer=1` quedan leídos
   * los del otro; el panel lo pide solo mientras la conversación está a la vista.
   */
  app.get("/messages/conversations/:id", guard, async (request): Promise<ConversationDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    const query = parseOrThrow(conversationQuery, request.query);
    const c = await load(request, id);
    let cursor: Date | null = null;
    if (query.antes) {
      const [ref] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.id, query.antes), eq(messages.conversationId, id)));
      if (!ref) throw notFound("Mensaje no encontrado");
      cursor = ref.createdAt;
    }
    const page = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), cursor ? lt(messages.createdAt, cursor) : undefined))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(PAGE + 1);
    if (query.leer === "1" && !query.antes) {
      await db
        .update(conversationMembers)
        .set({
          lastReadAt: sql`greatest(${conversationMembers.lastReadAt}, (select max(${messages.createdAt}) from ${messages} where ${messages.conversationId} = ${id}))`,
        })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, c.me)));
    }
    const otherPerson = await person(c.schoolId, c.otherUserId, c.otherName);
    const shown = page.slice(0, PAGE).reverse();
    const attached = await attachmentsOf(shown.map((m) => m.id));
    return {
      id,
      other: otherPerson,
      messages: shown.map((m) => toMessageDto(m, c.me, c.otherReadAt, attached.get(m.id))),
      hasOlder: page.length > PAGE,
      canSend: otherPerson.role !== null,
    };
  });

  /** Quien escribe y a quien: los dos tienen que seguir en el centro. */
  async function canWrite(request: FastifyRequest, id: string) {
    const c = await load(request, id);
    const staff = await messagingStaff(db, c.schoolId, [c.me, c.otherUserId]);
    if (!staff.has(c.otherUserId)) {
      throw conflict(`${c.otherName} ya no trabaja en el centro: no se le pueden mandar mensajes`);
    }
    if (!staff.has(c.me)) throw conflict("Tu acceso a este centro ya no está activo");
    return { ...c, senderName: staff.get(c.me)?.name ?? request.auth.name };
  }

  /**
   * Guarda el mensaje (y su adjunto, si trae) y avisa al otro. Dentro del horario de atención se
   * avisa al momento; fuera, al empezar la jornada.
   */
  async function deliver(
    request: FastifyRequest,
    c: Awaited<ReturnType<typeof canWrite>>,
    body: string,
    attachment?: Omit<typeof messageAttachments.$inferInsert, "messageId" | "conversationId" | "schoolId">,
  ): Promise<MessageDto> {
    const [school] = await db
      .select({ weekendNotices: schools.weekendNotices })
      .from(schools)
      .where(eq(schools.id, c.schoolId));
    const notifyNow = canNotify && withinNotifyHours(now(), { weekends: school?.weekendNotices ?? false });
    const { message, saved } = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({ conversationId: c.conversation.id, schoolId: c.schoolId, senderUserId: c.me, body })
        .returning();
      if (!row) throw new Error("No se envió el mensaje");
      const [saved] = attachment
        ? await tx
            .insert(messageAttachments)
            .values({
              ...attachment,
              messageId: row.id,
              conversationId: row.conversationId,
              schoolId: c.schoolId,
            })
            .returning()
        : [];
      await tx
        .update(conversations)
        .set({ lastMessageAt: row.createdAt, lastSenderId: c.me })
        .where(eq(conversations.id, row.conversationId));
      await tx
        .update(conversationMembers)
        .set({ lastReadAt: row.createdAt })
        .where(
          and(
            eq(conversationMembers.conversationId, row.conversationId),
            eq(conversationMembers.userId, c.me),
          ),
        );
      if (notifyNow) {
        await tx
          .update(conversationMembers)
          .set({ notifiedAt: row.createdAt })
          .where(
            and(
              eq(conversationMembers.conversationId, row.conversationId),
              eq(conversationMembers.userId, c.otherUserId),
            ),
          );
      }
      return { message: row, saved };
    });
    if (notifyNow) {
      // El aviso no frena el envío: si el servicio de avisos tarda o falla, el mensaje ya quedó.
      const payload = messagePayload(message.conversationId, c.senderName, saved?.kind ?? null);
      void pushToUsers(db, notifier, [c.otherUserId], payload).catch((err) =>
        request.log.warn({ err }, "No se envió el aviso del mensaje"),
      );
    }
    return toMessageDto(message, c.me, c.otherReadAt, saved);
  }

  app.post("/messages/conversations/:id/messages", guard, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { body } = parseOrThrow(messageInputSchema, request.body);
    const c = await canWrite(request, id);
    return reply.status(201).send(await deliver(request, c, body));
  });

  // ───────────────────────────── Fotos, videos y documentos ─────────────────────────────

  /**
   * Sube un adjunto y lo manda como mensaje. El cuerpo de la petición es el archivo tal cual; el tipo
   * va en Content-Type, el tamaño en Content-Length y el nombre en X-File-Name (codificado como URL).
   * El archivo se revisa mientras llega y se guarda antes de crear el mensaje; si algo falla, se borra.
   */
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, payload, done) => done(null, payload));
    scope.post("/messages/conversations/:id/attachments", guard, async (request, reply) => {
      const { id } = parseOrThrow(idParams, request.params);
      const declaredType =
        String(request.headers["content-type"] ?? "")
          .split(";")[0]
          ?.trim() ?? "";
      let rawName = "";
      try {
        rawName = decodeURIComponent(String(request.headers["x-file-name"] ?? ""));
      } catch {
        throw badRequest("Nombre de archivo inválido");
      }
      const contentType = attachmentTypeOf(rawName, declaredType);
      const type = contentType ? ATTACHMENT_TYPES[contentType] : undefined;
      if (!contentType || !type) {
        throw new ApiError(
          415,
          "unsupported_media",
          "Solo se pueden enviar fotos (JPG, PNG), videos (MP4, MOV) y documentos (PDF, Word, Excel, PowerPoint).",
        );
      }
      const size = Number(request.headers["content-length"]);
      if (!Number.isInteger(size) || size <= 0)
        throw new ApiError(411, "length_required", "Falta el tamaño del archivo");
      const max = ATTACHMENT_MAX_BYTES[type.kind];
      if (size > max) {
        request.raw.resume();
        throw new ApiError(
          413,
          "too_large",
          `El archivo pesa demasiado: el máximo es ${Math.round(max / (1024 * 1024))} MB.`,
        );
      }
      const c = await canWrite(request, id);
      const key = `${c.schoolId}/${id}/${randomUUID()}.${type.ext}`;
      const body = checkedUpload(request.body as Readable, {
        contentType,
        declaredSize: size,
        kind: type.kind,
        max,
      });
      await files.put(key, body, size, contentType);
      try {
        const dto = await deliver(request, c, "", {
          kind: type.kind,
          fileName: cleanFileName(rawName, type.ext),
          contentType,
          sizeBytes: size,
          storageKey: key,
        });
        return reply.status(201).send(dto);
      } catch (err) {
        await files.delete(key).catch(() => {});
        throw err;
      }
    });
  });

  /**
   * Entrega un adjunto a quien está en la conversación. Acepta un tramo (`Range`), que es como los
   * navegadores reproducen los videos. Los documentos se descargan; fotos y videos se muestran.
   */
  app.get("/messages/attachments/:id", guard, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select({ attachment: messageAttachments })
      .from(messageAttachments)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messageAttachments.conversationId),
          eq(conversationMembers.userId, request.auth.userId),
        ),
      )
      .where(and(eq(messageAttachments.id, id), eq(messageAttachments.schoolId, tenantOf(request))));
    if (!row) throw notFound("Archivo no encontrado");
    const a = row.attachment;
    const range = parseRange(request.headers.range, a.sizeBytes);
    if (range === "invalid") {
      return reply.status(416).header("content-range", `bytes */${a.sizeBytes}`).send();
    }
    const stream = await files.get(a.storageKey, range ?? undefined);
    reply
      .header("content-type", a.contentType)
      .header("content-disposition", contentDisposition(a.kind as AttachmentKind, a.fileName))
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, max-age=86400, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox");
    if (range) {
      reply
        .status(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${a.sizeBytes}`)
        .header("content-length", range.end - range.start + 1);
    } else {
      reply.header("content-length", a.sizeBytes);
    }
    return reply.send(stream);
  });

  // ───────────────────────────── Avisos en el celular ─────────────────────────────

  app.get(
    "/push/key",
    guard,
    async (): Promise<PushKeyDto> => ({
      publicKey: push?.publicKey ?? null,
      nativeAvailable: nativePush !== null,
    }),
  );

  /** Este teléfono avisa de los mensajes de quien inició sesión (si era de otra persona, cambia de dueño). */
  app.post("/push/subscriptions", guard, async (request, reply) => {
    if (!push) throw conflict("Los avisos en el celular no están configurados en esta instalación");
    const input = parseOrThrow(pushSubscriptionSchema, request.body);
    const me = request.auth.userId;
    await db.transaction(async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({ userId: me, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId: me, p256dh: input.keys.p256dh, auth: input.keys.auth, createdAt: sql`now()` },
        });
      const keep = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, me))
        .orderBy(desc(pushSubscriptions.createdAt))
        .limit(MAX_DEVICES);
      await tx.delete(pushSubscriptions).where(
        and(
          eq(pushSubscriptions.userId, me),
          notInArray(
            pushSubscriptions.id,
            keep.map((k) => k.id),
          ),
        ),
      );
    });
    return reply.status(204).send();
  });

  /** Al desactivar los avisos o cerrar sesión en ese teléfono. */
  app.post("/push/subscriptions/remove", guard, async (request, reply) => {
    const { endpoint } = parseOrThrow(pushEndpointSchema, request.body);
    await db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, request.auth.userId)),
      );
    return reply.status(204).send();
  });

  /** La app de Android en este teléfono avisa a quien inició sesión (si era de otra persona, cambia de dueño). */
  app.post("/push/devices", guard, async (request, reply) => {
    if (!nativePush) throw conflict("Los avisos de la app no están configurados en esta instalación");
    const input = parseOrThrow(pushDeviceSchema, request.body);
    const me = request.auth.userId;
    await db.transaction(async (tx) => {
      await tx
        .insert(pushDevices)
        .values({ userId: me, token: input.token, platform: input.platform })
        .onConflictDoUpdate({
          target: pushDevices.token,
          set: { userId: me, platform: input.platform, createdAt: sql`now()` },
        });
      const keep = await tx
        .select({ id: pushDevices.id })
        .from(pushDevices)
        .where(eq(pushDevices.userId, me))
        .orderBy(desc(pushDevices.createdAt))
        .limit(MAX_DEVICES);
      await tx.delete(pushDevices).where(
        and(
          eq(pushDevices.userId, me),
          notInArray(
            pushDevices.id,
            keep.map((k) => k.id),
          ),
        ),
      );
    });
    return reply.status(204).send();
  });

  /** Al desactivar los avisos o cerrar sesión en la app. */
  app.post("/push/devices/remove", guard, async (request, reply) => {
    const { token } = parseOrThrow(pushDeviceTokenSchema, request.body);
    await db
      .delete(pushDevices)
      .where(and(eq(pushDevices.token, token), eq(pushDevices.userId, request.auth.userId)));
    return reply.status(204).send();
  });
}
