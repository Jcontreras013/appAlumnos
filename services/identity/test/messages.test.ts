import type {
  ConversationDto,
  ConversationSummaryDto,
  CreatedUserDto,
  MessageContactDto,
  MessageDto,
  PushKeyDto,
  PushPayload,
  UnreadMessagesDto,
} from "@escolar/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { messages, pushDevices, pushSubscriptions } from "../src/db/schema";
import { fcmMessage, fcmSender, type NativePushSender, parseServiceAccount } from "../src/lib/fcm";
import { sendPendingNotices } from "../src/lib/messages";
import { type PushResult, type PushSender, type PushTarget, webPushSender } from "../src/lib/push";
import { type IdentityTestContext, PASSWORD, setupIdentity } from "./helpers";

/** Mensajes entre maestros y dirección: cada quien ve solo sus conversaciones, en su centro. */

// Martes 10 de noviembre de 2026, 10:00 en Honduras (16:00 UTC): dentro del horario de atención.
const WORKDAY = new Date("2026-11-10T16:00:00Z");
// El mismo martes a las 21:00 en Honduras: fuera de horario.
const NIGHT = new Date("2026-11-11T03:00:00Z");
// Miércoles 6:05 en Honduras: empieza la jornada.
const MORNING = new Date("2026-11-11T12:05:00Z");

let clock = WORKDAY;
const sent: { target: PushTarget; payload: PushPayload }[] = [];
let nextResult: PushResult = "sent";
const fakePush: PushSender = {
  publicKey: "llave-publica-de-prueba",
  async send(target, payload) {
    sent.push({ target, payload });
    return nextResult;
  },
};
/** La app de Android (Firebase). */
const sentToApp: { token: string; payload: PushPayload }[] = [];
let nextAppResult: PushResult = "sent";
const fakeNative: NativePushSender = {
  async send(token, payload) {
    sentToApp.push({ token, payload });
    return nextAppResult;
  },
};

let ctx: IdentityTestContext;
let admin: string;
let ana: { id: string; token: string };
let beto: { id: string; token: string };
let carla: { id: string; token: string };
let sara: { id: string; token: string };
let otherAdmin: string;

async function staff(slug: string, adminToken: string, name: string, role: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}@${slug}.hn`;
  const res = await ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(adminToken),
    payload: { name, email, password: PASSWORD, role },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { id: (res.json() as CreatedUserDto).id, token: await ctx.tokenFor(email) };
}

const call = async <T>(token: string, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await ctx.app.inject({ method, url, headers: ctx.auth(token), payload: payload as object });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
};

const open = async (token: string, userId: string) =>
  (await call<{ id: string }>(token, "POST", "/messages/conversations", { userId })).body.id;
const send = (token: string, id: string, body: string) =>
  call<MessageDto>(token, "POST", `/messages/conversations/${id}/messages`, { body });
const view = (token: string, id: string, read = false) =>
  call<ConversationDto>(token, "GET", `/messages/conversations/${id}${read ? "?leer=1" : ""}`);
const unread = async (token: string) =>
  (await call<UnreadMessagesDto>(token, "GET", "/messages/unread")).body.conversations;

beforeAll(async () => {
  ctx = await setupIdentity({}, { push: fakePush, nativePush: fakeNative, now: () => clock });
  const school = await ctx.createSchool("escuela-mensajes");
  admin = school.adminToken;
  ana = await staff("escuela-mensajes", admin, "Ana Docente", "docente");
  beto = await staff("escuela-mensajes", admin, "Beto Docente", "docente");
  carla = await staff("escuela-mensajes", admin, "Carla Docente", "docente");
  sara = await staff("escuela-mensajes", admin, "Sara Secretaria", "secretaria");
  otherAdmin = (await ctx.createSchool("otra-escuela")).adminToken;
});
afterAll(() => ctx.close());

describe("contactos", () => {
  it("cada quien ve a los maestros, la dirección y la secretaría de su centro, sin contarse a sí mismo", async () => {
    const { body } = await call<MessageContactDto[]>(ana.token, "GET", "/messages/contacts");
    expect(body.map((c) => c.name)).toEqual(["Admin", "Beto Docente", "Carla Docente", "Sara Secretaria"]);
    expect(body.find((c) => c.name === "Admin")?.role).toBe("admin");
  });

  it("la secretaría escribe a los maestros y a la dirección", async () => {
    const { body } = await call<MessageContactDto[]>(sara.token, "GET", "/messages/contacts");
    expect(body.map((c) => c.name)).toEqual(["Admin", "Ana Docente", "Beto Docente", "Carla Docente"]);
    expect(
      (await call(sara.token, "POST", "/messages/conversations", { userId: ana.id })).status,
    ).toBeLessThan(300);
  });

  it("no se abre conversación con alguien de otro centro o consigo mismo", async () => {
    const { body: outsiders } = await call<MessageContactDto[]>(otherAdmin, "GET", "/messages/contacts");
    expect(outsiders).toEqual([]);
    expect((await call(otherAdmin, "POST", "/messages/conversations", { userId: ana.id })).status).toBe(404);
    expect((await call(ana.token, "POST", "/messages/conversations", { userId: ana.id })).status).toBe(400);
  });
});

describe("conversaciones", () => {
  let id: string;

  it("entre dos personas hay una sola conversación, la abra quien la abra", async () => {
    id = await open(ana.token, beto.id);
    expect(await open(ana.token, beto.id)).toBe(id);
    expect(await open(beto.token, ana.id)).toBe(id);
    // Sin mensajes todavía no aparece en la lista.
    expect((await call<ConversationSummaryDto[]>(ana.token, "GET", "/messages/conversations")).body).toEqual(
      [],
    );
  });

  it("el mensaje llega sin leer y el que escribe ve cuándo lo leyeron", async () => {
    const res = await send(ana.token, id, "  Buenos días, ¿me presta el libro de Ciencias?  ");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ body: "Buenos días, ¿me presta el libro de Ciencias?", mine: true });
    expect(res.body.seen).toBe(false);

    expect(await unread(beto.token)).toBe(1);
    expect(await unread(ana.token)).toBe(0);
    const [summary] = (await call<ConversationSummaryDto[]>(beto.token, "GET", "/messages/conversations"))
      .body;
    expect(summary).toMatchObject({
      id,
      other: { name: "Ana Docente", role: "docente" },
      unread: 1,
      lastMessage: { mine: false },
    });

    // Abrir sin estar a la vista no marca nada; con leer=1, sí.
    await view(beto.token, id);
    expect(await unread(beto.token)).toBe(1);
    const opened = await view(beto.token, id, true);
    expect(opened.body.messages).toHaveLength(1);
    expect(opened.body.messages[0]?.mine).toBe(false);
    expect(await unread(beto.token)).toBe(0);
    expect((await view(ana.token, id)).body.messages[0]?.seen).toBe(true);
  });

  it("rechaza mensajes vacíos o demasiado largos", async () => {
    expect((await send(ana.token, id, "   ")).status).toBe(400);
    expect((await send(ana.token, id, "a".repeat(2001))).status).toBe(400);
  });

  it("nadie más lee la conversación: ni otro maestro, ni secretaría, ni otro centro", async () => {
    expect((await view(carla.token, id)).status).toBe(404);
    expect((await send(carla.token, id, "Hola")).status).toBe(404);
    expect((await view(sara.token, id)).status).toBe(404);
    expect((await view(otherAdmin, id)).status).toBe(404);
  });

  it("los mensajes no se pueden cambiar ni borrar, ni desde la base de datos", async () => {
    await expect(
      ctx.db.update(messages).set({ body: "otro" }).where(eq(messages.conversationId, id)),
    ).rejects.toThrow();
    await expect(ctx.db.delete(messages).where(eq(messages.conversationId, id))).rejects.toThrow();
  });

  it("muestra los últimos 50 y trae los anteriores al pedirlos", async () => {
    const pageId = await open(carla.token, beto.id);
    for (let i = 1; i <= 53; i++) expect((await send(carla.token, pageId, `Mensaje ${i}`)).status).toBe(201);
    const latest = (await view(carla.token, pageId)).body;
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasOlder).toBe(true);
    expect(latest.messages.at(-1)?.body).toBe("Mensaje 53");
    const first = latest.messages[0]?.id;
    const older = (
      await call<ConversationDto>(carla.token, "GET", `/messages/conversations/${pageId}?antes=${first}`)
    ).body;
    expect(older.messages.map((m) => m.body)).toEqual(["Mensaje 1", "Mensaje 2", "Mensaje 3"]);
    expect(older.hasOlder).toBe(false);
    // Beto tiene dos conversaciones sin leer; la más reciente va primero.
    expect(await unread(beto.token)).toBe(1);
    const list = (await call<ConversationSummaryDto[]>(beto.token, "GET", "/messages/conversations")).body;
    expect(list.map((c) => c.other.name)).toEqual(["Carla Docente", "Ana Docente"]);
    expect(list[0]?.unread).toBe(53);
  });

  it("si alguien deja el centro, la conversación se conserva pero ya no se le escribe", async () => {
    const deactivate = await call(admin, "POST", `/users/${beto.id}/status`, { active: false });
    expect(deactivate.status).toBe(200);
    const conversation = (await view(ana.token, id)).body;
    expect(conversation.canSend).toBe(false);
    expect(conversation.other.role).toBeNull();
    expect(conversation.messages).toHaveLength(1);
    const res = await call<{ error: { message: string } }>(
      ana.token,
      "POST",
      `/messages/conversations/${id}/messages`,
      { body: "¿Sigue ahí?" },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("ya no trabaja en el centro");
    const contacts = (await call<MessageContactDto[]>(ana.token, "GET", "/messages/contacts")).body;
    expect(contacts.map((c) => c.name)).not.toContain("Beto Docente");
    await call(admin, "POST", `/users/${beto.id}/status`, { active: true });
  });
});

describe("avisos en el celular", () => {
  const subscription = (n: number) => ({
    endpoint: `https://push.ejemplo.test/telefono-${n}`,
    keys: { p256dh: "BCLAVE", auth: "AUTH" },
  });

  it("da la llave pública y guarda el teléfono de quien activa los avisos", async () => {
    expect((await call<PushKeyDto>(ana.token, "GET", "/push/key")).body.publicKey).toBe(
      "llave-publica-de-prueba",
    );
    expect((await call(ana.token, "POST", "/push/subscriptions", subscription(1))).status).toBe(204);
    expect((await call(beto.token, "POST", "/push/subscriptions", subscription(2))).status).toBe(204);
    expect(
      (await call(beto.token, "POST", "/push/subscriptions", { ...subscription(3), endpoint: "http://x" }))
        .status,
    ).toBe(400);
  });

  it("en horario de atención avisa al momento, sin el texto del mensaje", async () => {
    clock = WORKDAY;
    sent.length = 0;
    const id = await open(ana.token, beto.id);
    await send(ana.token, id, "Reunión a las 2, información confidencial");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [notice] = sent;
    expect(notice?.target.endpoint).toBe("https://push.ejemplo.test/telefono-2");
    expect(notice?.payload).toEqual({
      title: "Ana Docente",
      body: "Te envió un mensaje.",
      url: `/panel/mensajes/${id}`,
      tag: `conversacion-${id}`,
    });
    // Ya se le avisó: la revisión de la mañana no repite el aviso.
    expect(await sendPendingNotices(ctx.db, { web: fakePush, native: null }, MORNING)).toBe(0);
  });

  it("de noche no avisa; al empezar la jornada manda un solo aviso con lo pendiente", async () => {
    clock = NIGHT;
    sent.length = 0;
    const id = await open(beto.token, ana.id);
    await send(beto.token, id, "Mañana llego tarde");
    await send(beto.token, id, "Por favor avise a la dirección");
    expect(await sendPendingNotices(ctx.db, { web: fakePush, native: null }, NIGHT)).toBe(0);
    expect(sent).toHaveLength(0);

    expect(await sendPendingNotices(ctx.db, { web: fakePush, native: null }, MORNING)).toBe(1);
    expect(sent.map((s) => s.target.endpoint)).toEqual(["https://push.ejemplo.test/telefono-1"]);
    expect(sent[0]?.payload.body).toBe("Tienes un mensaje sin leer de un compañero.");
    expect(await sendPendingNotices(ctx.db, { web: fakePush, native: null }, MORNING)).toBe(0);
  });

  it("si ya lo leyó antes de la mañana, no se le avisa", async () => {
    clock = NIGHT;
    sent.length = 0;
    const id = await open(beto.token, ana.id);
    await send(beto.token, id, "Otra cosa");
    await view(ana.token, id, true);
    expect(await sendPendingNotices(ctx.db, { web: fakePush, native: null }, MORNING)).toBe(0);
  });

  it("olvida el teléfono que ya no acepta avisos", async () => {
    clock = WORKDAY;
    nextResult = "gone";
    sent.length = 0;
    const id = await open(ana.token, beto.id);
    await send(ana.token, id, "¿Recibió?");
    await vi.waitFor(async () => {
      const left = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, beto.id));
      expect(left).toEqual([]);
    });
    nextResult = "sent";
  });

  it("al desactivarlos en ese teléfono deja de avisar ahí", async () => {
    expect(
      (await call(ana.token, "POST", "/push/subscriptions/remove", { endpoint: subscription(1).endpoint }))
        .status,
    ).toBe(204);
    const left = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, ana.id));
    expect(left).toEqual([]);
  });

  it("sin llaves configuradas los mensajes funcionan pero no hay avisos", async () => {
    const off = await setupIdentity();
    const school = await off.createSchool("sin-avisos");
    const res = await off.app.inject({ url: "/push/key", headers: off.auth(school.adminToken) });
    expect(res.json()).toEqual({ publicKey: null, nativeAvailable: false });
    const sub = await off.app.inject({
      method: "POST",
      url: "/push/subscriptions",
      headers: off.auth(school.adminToken),
      payload: subscription(9),
    });
    expect(sub.statusCode).toBe(409);
    await off.close();
  });
});

describe("avisos en la app de Android", () => {
  const TOKEN = (n: number) => `fcm-token-de-prueba-${n}:APA91b${"x".repeat(40)}`;

  it("la app se registra con el identificador que le dio Firebase", async () => {
    expect((await call<PushKeyDto>(carla.token, "GET", "/push/key")).body.nativeAvailable).toBe(true);
    expect(
      (await call(carla.token, "POST", "/push/devices", { token: TOKEN(1), platform: "android" })).status,
    ).toBe(204);
    expect(
      (await call(carla.token, "POST", "/push/devices", { token: "corto", platform: "android" })).status,
    ).toBe(400);
    expect(
      (await call(carla.token, "POST", "/push/devices", { token: TOKEN(2), platform: "ios" })).status,
    ).toBe(400);
  });

  it("los mensajes avisan también a la app, sin el texto", async () => {
    clock = WORKDAY;
    sentToApp.length = 0;
    const id = await open(beto.token, carla.id);
    await send(beto.token, id, "Información confidencial del expediente");
    await vi.waitFor(() => expect(sentToApp).toHaveLength(1));
    expect(sentToApp[0]).toEqual({
      token: TOKEN(1),
      payload: {
        title: "Beto Docente",
        body: "Te envió un mensaje.",
        url: `/panel/mensajes/${id}`,
        tag: `conversacion-${id}`,
      },
    });
  });

  it("si en ese teléfono entra otra persona, los avisos pasan a ella", async () => {
    expect(
      (await call(beto.token, "POST", "/push/devices", { token: TOKEN(1), platform: "android" })).status,
    ).toBe(204);
    const rows = await ctx.db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.token, TOKEN(1)));
    expect(rows.map((r) => r.userId)).toEqual([beto.id]);
    // Quitarlo solo lo puede su dueño actual.
    expect((await call(carla.token, "POST", "/push/devices/remove", { token: TOKEN(1) })).status).toBe(204);
    expect(
      await ctx.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.token, TOKEN(1))),
    ).toHaveLength(1);
    expect((await call(beto.token, "POST", "/push/devices/remove", { token: TOKEN(1) })).status).toBe(204);
    expect(
      await ctx.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.token, TOKEN(1))),
    ).toHaveLength(0);
  });

  it("olvida la app que Firebase ya no reconoce", async () => {
    await call(carla.token, "POST", "/push/devices", { token: TOKEN(3), platform: "android" });
    clock = WORKDAY;
    nextAppResult = "gone";
    const id = await open(beto.token, carla.id);
    await send(beto.token, id, "¿Recibió?");
    await vi.waitFor(async () => {
      expect(await ctx.db.select().from(pushDevices).where(eq(pushDevices.userId, carla.id))).toEqual([]);
    });
    nextAppResult = "sent";
  });
});

describe("Firebase Cloud Messaging", () => {
  // Cuenta de servicio de prueba (una llave RSA generada aquí, como la que descarga Firebase).
  async function account() {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    return JSON.stringify({
      type: "service_account",
      project_id: "conecta-prueba",
      client_email: "avisos@conecta-prueba.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
  }
  const payload = {
    title: "Ana",
    body: "Te envió un mensaje.",
    url: "/panel/mensajes/1",
    tag: "conversacion-1",
  };

  it("pide permiso a Google una vez por hora y manda el aviso a Firebase", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("https://oauth2.googleapis.com/")) {
        return Response.json({ access_token: "permiso-de-prueba", expires_in: 3600 });
      }
      return Response.json({ name: "projects/conecta-prueba/messages/1" });
    }) as unknown as typeof fetch;
    const sender = fcmSender(parseServiceAccount(await account()), fakeFetch);
    expect(await sender.send("token-1", payload)).toBe("sent");
    expect(await sender.send("token-2", payload)).toBe("sent");
    expect(calls.map((c) => c.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://fcm.googleapis.com/v1/projects/conecta-prueba/messages:send",
      "https://fcm.googleapis.com/v1/projects/conecta-prueba/messages:send",
    ]);
    const grant = new URLSearchParams(String(calls[0]?.init.body));
    expect(grant.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(grant.get("assertion")?.split(".")).toHaveLength(3);
    const headers = (calls[1]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer permiso-de-prueba");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ message: fcmMessage("token-1", payload) });
  });

  it("distingue el teléfono que ya no existe de una falla pasajera", async () => {
    const reply = (status: number, body: unknown) =>
      (async (url: string) =>
        url.startsWith("https://oauth2")
          ? Response.json({ access_token: "p", expires_in: 3600 })
          : Response.json(body, { status })) as unknown as typeof fetch;
    const json = await account();
    const unregistered = {
      error: { message: "Requested entity was not found.", details: [{ errorCode: "UNREGISTERED" }] },
    };
    expect(await fcmSender(parseServiceAccount(json), reply(404, unregistered)).send("t", payload)).toBe(
      "gone",
    );
    const badToken = {
      error: {
        message: "The registration token is not a valid FCM registration token",
        details: [{ errorCode: "INVALID_ARGUMENT" }],
      },
    };
    expect(await fcmSender(parseServiceAccount(json), reply(400, badToken)).send("t", payload)).toBe("gone");
    expect(await fcmSender(parseServiceAccount(json), reply(503, { error: {} })).send("t", payload)).toBe(
      "failed",
    );
  });

  it("explica si la cuenta de servicio está mal", () => {
    expect(() => parseServiceAccount("no es json")).toThrow(/JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ project_id: "x" }))).toThrow(/private_key/);
  });
});

describe("Web Push", () => {
  it("manda el aviso cifrado con la firma de la instalación", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    // Llaves de prueba generadas con web-push; el teléfono de prueba usa una llave P-256 válida.
    const { generateVapidKeys } = await import("../src/lib/push");
    const vapid = { ...generateVapidKeys(), subject: "mailto:soporte@ejemplo.hn" };
    const { createECDH, randomBytes } = await import("node:crypto");
    const phone = createECDH("prime256v1");
    phone.generateKeys();
    const target = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: phone.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    };
    const result = await webPushSender(vapid, fakeFetch).send(target, {
      title: "Ana",
      body: "Te envió un mensaje.",
      url: "/panel/mensajes",
      tag: "x",
    });
    expect(result).toBe("sent");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe(target.endpoint);
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    // El cuerpo va cifrado: no se puede leer el aviso en el camino.
    expect(Buffer.from(calls[0]?.init.body as Uint8Array).toString()).not.toContain("Ana");

    const gone = webPushSender(
      vapid,
      (async () => new Response(null, { status: 410 })) as unknown as typeof fetch,
    );
    expect(await gone.send(target, { title: "", body: "", url: "/", tag: "" })).toBe("gone");
  });
});
