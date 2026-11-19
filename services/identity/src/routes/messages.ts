import { badRequest, conflict, notFound, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type ConversationDto,
  type ConversationPersonDto,
  type ConversationSummaryDto,
  MESSAGING_ROLES,
  type MessageContactDto,
  type MessageDto,
  messageInputSchema,
  type PushKeyDto,
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
  messages,
  pushSubscriptions,
  users,
} from "../db/schema";
import type { IdentityDeps } from "../deps";
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
export async function messageRoutes(app: FastifyInstance, { db, push, now }: IdentityDeps) {
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

  const toMessageDto = (m: Message, me: string, otherReadAt: Date | null): MessageDto => ({
    id: m.id,
    body: m.body,
    sentAt: m.createdAt.toISOString(),
    mine: m.senderUserId === me,
    seen: m.senderUserId === me && otherReadAt !== null && m.createdAt <= otherReadAt,
  });

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
    return rows.map((r) => {
      const m = lastBy.get(r.id);
      return {
        id: r.id,
        other: { userId: r.otherUserId, name: r.otherName, role: staff.get(r.otherUserId)?.role ?? null },
        lastMessage: m
          ? { body: m.body, sentAt: m.createdAt.toISOString(), mine: m.senderUserId === me }
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
    return {
      id,
      other: otherPerson,
      messages: page
        .slice(0, PAGE)
        .reverse()
        .map((m) => toMessageDto(m, c.me, c.otherReadAt)),
      hasOlder: page.length > PAGE,
      canSend: otherPerson.role !== null,
    };
  });

  app.post("/messages/conversations/:id/messages", guard, async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const { body } = parseOrThrow(messageInputSchema, request.body);
    const c = await load(request, id);
    const staff = await messagingStaff(db, c.schoolId, [c.me, c.otherUserId]);
    if (!staff.has(c.otherUserId)) {
      throw conflict(`${c.otherName} ya no trabaja en el centro: no se le pueden mandar mensajes`);
    }
    if (!staff.has(c.me)) throw conflict("Tu acceso a este centro ya no está activo");
    // Dentro del horario de atención se avisa al momento; fuera, al empezar la jornada.
    const notifyNow = push !== null && withinNotifyHours(now());
    const message = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({ conversationId: id, schoolId: c.schoolId, senderUserId: c.me, body })
        .returning();
      if (!row) throw new Error("No se envió el mensaje");
      await tx
        .update(conversations)
        .set({ lastMessageAt: row.createdAt, lastSenderId: c.me })
        .where(eq(conversations.id, id));
      await tx
        .update(conversationMembers)
        .set({ lastReadAt: row.createdAt })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, c.me)));
      if (notifyNow) {
        await tx
          .update(conversationMembers)
          .set({ notifiedAt: row.createdAt })
          .where(
            and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, c.otherUserId)),
          );
      }
      return row;
    });
    if (push && notifyNow) {
      // El aviso no frena el envío: si el servicio de avisos tarda o falla, el mensaje ya quedó.
      const sender = staff.get(c.me)?.name ?? request.auth.name;
      void pushToUsers(db, push, [c.otherUserId], messagePayload(id, sender)).catch((err) =>
        request.log.warn({ err }, "No se envió el aviso del mensaje"),
      );
    }
    return reply.status(201).send(toMessageDto(message, c.me, c.otherReadAt));
  });

  // ───────────────────────────── Avisos en el celular ─────────────────────────────

  app.get("/push/key", guard, async (): Promise<PushKeyDto> => ({ publicKey: push?.publicKey ?? null }));

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
}
