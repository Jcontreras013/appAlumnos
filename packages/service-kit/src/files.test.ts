import { Readable } from "node:stream";
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import { s3FileStore } from "./files";
import { checkedStream } from "./uploads";

/**
 * S3 de mentira que se porta como el de verdad: la subida termina cuando llegaron todos los bytes
 * anunciados y no se entera si el archivo falla a medio camino (el real espera hasta cortar por
 * tiempo); solo la señal de cancelar la corta.
 */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const client = {
    async send(command: unknown, options?: { abortSignal?: AbortSignal }) {
      if (command instanceof DeleteObjectCommand) {
        objects.delete(command.input.Key as string);
        return {};
      }
      if (!(command instanceof PutObjectCommand)) throw new Error("no soportado");
      const { Key, Body, ContentLength } = command.input;
      return new Promise((resolve, reject) => {
        options?.abortSignal?.addEventListener("abort", () => reject(new Error("Request aborted")));
        const chunks: Buffer[] = [];
        let received = 0;
        (Body as Readable).on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          received += chunk.length;
          if (received === ContentLength) {
            objects.set(Key as string, Buffer.concat(chunks));
            resolve({});
          }
        });
      });
    },
  };
  return { objects, store: s3FileStore("bucket", client as unknown as S3Client) };
}

const inParts = (buf: Buffer) =>
  Readable.from(
    (async function* () {
      for (let i = 0; i < buf.length; i += 1024) yield buf.subarray(i, i + 1024);
    })(),
  );
const checked = (buf: Buffer, declaredSize: number) =>
  checkedStream(inParts(buf), {
    contentType: "image/jpeg",
    declaredSize,
    max: 1_000_000,
    tooLarge: () => new ApiError(413, "too_large", "Muy grande"),
  });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20_000, 7)]);

describe("archivos en S3", () => {
  it("guarda una foto completa", async () => {
    const { objects, store } = fakeS3();
    await store.put("aula/foto.jpg", checked(JPEG, JPEG.length), JPEG.length, "image/jpeg");
    expect(objects.get("aula/foto.jpg")?.equals(JPEG)).toBe(true);
  });

  it("acepta una foto con la extensión de otro formato (una captura PNG guardada como .jpg)", async () => {
    const { objects, store } = fakeS3();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(3000, 1),
    ]);
    await store.put("aula/captura.jpg", checked(png, png.length), png.length, "image/jpeg");
    expect(objects.get("aula/captura.jpg")?.equals(png)).toBe(true);
  });

  it("si el archivo no es lo que dice ser, devuelve el motivo enseguida (no «error inesperado»)", async () => {
    const { objects, store } = fakeS3();
    const fake = Buffer.concat([Buffer.from("esto no es una foto"), Buffer.alloc(5000)]);
    const err = await store
      .put("aula/falsa.jpg", checked(fake, fake.length), fake.length, "image/jpeg")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(415);
    expect(objects.size).toBe(0);
  });

  it("si el archivo llega incompleto, lo dice y no guarda nada", async () => {
    const { objects, store } = fakeS3();
    const err = await store
      .put("aula/cortada.jpg", checked(JPEG.subarray(0, 5000), JPEG.length), JPEG.length, "image/jpeg")
      .catch((e: unknown) => e);
    expect((err as ApiError).statusCode).toBe(400);
    expect((err as ApiError).message).toContain("incompleto");
    expect(objects.size).toBe(0);
  });

  it("si la última revisión falla cuando S3 ya tenía todo, borra lo guardado", async () => {
    const { objects, store } = fakeS3();
    const tiny = Buffer.from("hola");
    const err = await store
      .put("aula/mini.jpg", checked(tiny, tiny.length), tiny.length, "image/jpeg")
      .catch((e: unknown) => e);
    expect((err as ApiError).statusCode).toBe(415);
    expect(objects.has("aula/mini.jpg")).toBe(false);
  });
});
