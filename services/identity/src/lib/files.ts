import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Dónde se guardan las fotos, videos y documentos de los mensajes: en AWS, un bucket de S3 privado
 * (fuera de la base de datos, para que no crezca); en la demo y en desarrollo, una carpeta. Nunca hay
 * enlaces públicos: el servicio entrega cada archivo después de revisar quién lo pide.
 */
export interface FileStore {
  /** Guarda el contenido completo; si falla a medias, no queda nada guardado. */
  put(key: string, body: Readable, size: number, contentType: string): Promise<void>;
  /** El contenido, o el tramo [start, end] (ambos incluidos) para los videos. */
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** Carpeta local. Escribe en un archivo temporal y lo renombra al terminar. */
export function localFileStore(root: string): FileStore {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new Error("Ruta de archivo inválida");
    return path;
  };
  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.subiendo`;
      try {
        await pipeline(body, createWriteStream(temp, { flags: "wx" }));
        await rename(temp, path);
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
    },
    async get(key, range) {
      const path = pathOf(key);
      await stat(path);
      return createReadStream(path, range ? { start: range.start, end: range.end } : undefined);
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}

/** Bucket de S3. La región sale del entorno (AWS_REGION); los permisos, del rol de la tarea. */
export function s3FileStore(bucket: string, client = new S3Client({})): FileStore {
  return {
    async put(key, body, size, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: contentType,
        }),
      );
    },
    async get(key, range) {
      const res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      if (!(res.Body instanceof Readable)) throw new Error("S3 no devolvió el archivo");
      return res.Body;
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** En memoria, para las pruebas. */
export function memoryFileStore(): FileStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(key, body) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      files.set(key, Buffer.concat(chunks));
    },
    async get(key, range) {
      const data = files.get(key);
      if (!data) throw new Error(`No existe ${key}`);
      return Readable.from([range ? data.subarray(range.start, range.end + 1) : data]);
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

/** Carpeta por defecto en desarrollo (fuera de git). */
export const DEFAULT_FILES_DIR = join(process.cwd(), ".adjuntos");
