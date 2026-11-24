import { Readable } from "node:stream";
import {
  attachmentTypeOf,
  type ConversationDto,
  type ConversationSummaryDto,
  type CreatedUserDto,
  cleanFileName,
  type MessageDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messageAttachments } from "../src/db/schema";
import { checkedUpload, parseRange } from "../src/lib/attachments";
import { messagePayload } from "../src/lib/messages";
import { type IdentityTestContext, PASSWORD, setupIdentity } from "./helpers";

/** Fotos, videos y documentos en los mensajes: se revisan al subir y solo los ve quien está en la conversación. */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(500, 3)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 9)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 1)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0)]);

let ctx: IdentityTestContext;
let admin: string;
let ana: { id: string; token: string };
let beto: { id: string; token: string };
let otherAdmin: string;
let conversation: string;

async function staff(slug: string, adminToken: string, name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}@${slug}.hn`;
  const res = await ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(adminToken),
    payload: { name, email, password: PASSWORD, role: "docente" },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { id: (res.json() as CreatedUserDto).id, token: await ctx.tokenFor(email) };
}

const upload = (token: string, id: string, data: Buffer, type: string, name: string) =>
  ctx.app.inject({
    method: "POST",
    url: `/messages/conversations/${id}/attachments`,
    headers: { ...ctx.auth(token), "content-type": type, "x-file-name": encodeURIComponent(name) },
    payload: data,
  });
const download = (token: string, attachmentId: string, range?: string) =>
  ctx.app.inject({
    method: "GET",
    url: `/messages/attachments/${attachmentId}`,
    headers: { ...ctx.auth(token), ...(range ? { range } : {}) },
  });

beforeAll(async () => {
  ctx = await setupIdentity();
  const school = await ctx.createSchool("escuela-adjuntos");
  admin = school.adminToken;
  ana = await staff("escuela-adjuntos", admin, "Ana Docente");
  beto = await staff("escuela-adjuntos", admin, "Beto Docente");
  otherAdmin = (await ctx.createSchool("otra-escuela-adjuntos")).adminToken;
  const res = await ctx.app.inject({
    method: "POST",
    url: "/messages/conversations",
    headers: ctx.auth(admin),
    payload: { userId: ana.id },
  });
  conversation = (res.json() as { id: string }).id;
});
afterAll(() => ctx.close());

describe("enviar y ver adjuntos", () => {
  it("la maestra manda una foto y la dirección la ve en la conversación y la abre", async () => {
    const res = await upload(ana.token, conversation, JPEG, "image/jpeg", "periódico mural.jpg");
    expect(res.statusCode).toBe(201);
    const sent = res.json() as MessageDto;
    expect(sent).toMatchObject({ body: "", mine: true });
    expect(sent.attachment).toMatchObject({
      kind: "foto",
      name: "periódico mural.jpg",
      contentType: "image/jpeg",
      size: JPEG.length,
    });

    const view = await ctx.app.inject({
      method: "GET",
      url: `/messages/conversations/${conversation}`,
      headers: ctx.auth(admin),
    });
    const last = (view.json() as ConversationDto).messages.at(-1);
    expect(last?.attachment?.id).toBe(sent.attachment?.id);
    expect(last?.mine).toBe(false);

    const file = await download(admin, sent.attachment?.id ?? "");
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.headers["content-disposition"]).toMatch(/^inline;/);
    expect(file.headers["accept-ranges"]).toBe("bytes");
    expect(file.rawPayload.equals(JPEG)).toBe(true);
  });

  it("la lista de conversaciones dice que lo último fue una foto", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/messages/conversations",
      headers: ctx.auth(admin),
    });
    const [summary] = res.json() as ConversationSummaryDto[];
    expect(summary?.lastMessage?.attachment).toEqual({ kind: "foto", name: "periódico mural.jpg" });
    expect(summary?.unread).toBe(1);
  });

  it("los videos se entregan por tramos, como los piden los navegadores para reproducirlos", async () => {
    const sent = (
      await upload(admin, conversation, MP4, "video/mp4", "acto cívico.mp4")
    ).json() as MessageDto;
    expect(sent.attachment?.kind).toBe("video");
    const id = sent.attachment?.id ?? "";

    const part = await download(ana.token, id, "bytes=0-9");
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-9/${MP4.length}`);
    expect(part.rawPayload.equals(MP4.subarray(0, 10))).toBe(true);

    const tail = await download(ana.token, id, "bytes=-5");
    expect(tail.headers["content-range"]).toBe(`bytes ${MP4.length - 5}-${MP4.length - 1}/${MP4.length}`);
    expect(tail.rawPayload.equals(MP4.subarray(-5))).toBe(true);

    const outside = await download(ana.token, id, `bytes=${MP4.length + 10}-`);
    expect(outside.statusCode).toBe(416);
  });

  it("los documentos se descargan con su nombre, con tildes y eñes", async () => {
    const res = await upload(
      ana.token,
      conversation,
      DOCX,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Planificación de Español.docx",
    );
    const sent = res.json() as MessageDto;
    expect(sent.attachment?.kind).toBe("archivo");
    const file = await download(admin, sent.attachment?.id ?? "");
    const disposition = String(file.headers["content-disposition"]);
    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("Planificación de Español.docx")}`);
  });

  it("si el celular no dice el tipo, se toma por la extensión", async () => {
    const res = await upload(ana.token, conversation, PDF, "application/octet-stream", "Acta.pdf");
    expect(res.statusCode).toBe(201);
    expect((res.json() as MessageDto).attachment?.contentType).toBe("application/pdf");
  });
});

describe("lo que no se acepta", () => {
  it("un archivo que no es lo que dice ser, o un tipo no permitido, no se guarda", async () => {
    const before = ctx.files.files.size;
    const fake = await upload(ana.token, conversation, EXE, "image/jpeg", "foto.jpg");
    expect(fake.statusCode).toBe(415);
    const program = await upload(ana.token, conversation, EXE, "application/x-msdownload", "tarea.exe");
    expect(program.statusCode).toBe(415);
    expect(ctx.files.files.size).toBe(before);
  });

  it("un documento más grande que el máximo se rechaza", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(10 * 1024 * 1024)]);
    const res = await upload(ana.token, conversation, big, "application/pdf", "grande.pdf");
    expect(res.statusCode).toBe(413);
  });

  it("solo los de la conversación ven el adjunto: ni otro maestro del centro ni otro centro", async () => {
    const sent = (
      await upload(ana.token, conversation, JPEG, "image/jpeg", "privada.jpg")
    ).json() as MessageDto;
    const id = sent.attachment?.id ?? "";
    expect((await download(beto.token, id)).statusCode).toBe(404);
    expect((await download(otherAdmin, id)).statusCode).toBe(404);
    expect((await upload(beto.token, conversation, JPEG, "image/jpeg", "x.jpg")).statusCode).toBe(404);
  });

  it("los adjuntos son registro: no se pueden borrar", async () => {
    await expect(ctx.db.delete(messageAttachments)).rejects.toThrow();
  });
});

describe("piezas", () => {
  it("el aviso dice qué mandó, sin mostrarlo", () => {
    expect(messagePayload("c", "Ana", "video").body).toBe("Te envió un video.");
    expect(messagePayload("c", "Ana").body).toBe("Te envió un mensaje.");
  });

  it("lee los tramos que piden los navegadores", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange(undefined, 1000)).toBeNull();
  });

  it("limpia los nombres y reconoce el tipo por la extensión", () => {
    expect(cleanFileName("C:\\fotos\\mural.jpg", "jpg")).toBe("mural.jpg");
    expect(cleanFileName("../../etc/passwd", "pdf")).toBe("passwd");
    expect(cleanFileName('a"b<c>.pdf', "pdf")).toBe("abc.pdf");
    expect(cleanFileName("", "pdf")).toBe("adjunto.pdf");
    expect(cleanFileName(`${"x".repeat(300)}.pdf`, "pdf")).toHaveLength(120);
    expect(attachmentTypeOf("Notas.XLSX")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(attachmentTypeOf("video.MOV", "")).toBe("video/quicktime");
    expect(attachmentTypeOf("script.sh")).toBeNull();
  });

  it("si el archivo llega incompleto, no se guarda", async () => {
    const stream = checkedUpload(Readable.from([PDF]), {
      contentType: "application/pdf",
      declaredSize: PDF.length + 50,
      kind: "archivo",
      max: 1000,
    });
    await expect(async () => {
      for await (const _ of stream) {
        // consumir
      }
    }).rejects.toThrow(/incompleto/);
  });
});
