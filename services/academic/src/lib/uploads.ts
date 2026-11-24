import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { ApiError, badRequest, checkedStream, type FileStore } from "@escolar/service-kit";
import { CLASS_FILE_TYPES, classFileTypeOf, cleanFileName, formatFileSize } from "@escolar/shared";
import type { FastifyRequest } from "fastify";

export interface StoredUpload {
  key: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Guarda el archivo que viene en el cuerpo de la petición (PDF, Office o imagen) sin pasarlo por
 * memoria, revisando mientras llega que sea lo que dice ser y que no pase del máximo. El nombre va
 * en el encabezado x-file-name. Si después algo falla, quien llama borra `key`.
 */
export async function storeUpload(
  request: FastifyRequest,
  files: FileStore,
  options: { folder: string; max: number },
): Promise<StoredUpload> {
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
    throw new ApiError(415, "unsupported_media", "Se aceptan fotos, PDF, Word, Excel y PowerPoint.");
  }
  const size = Number(request.headers["content-length"]);
  if (!Number.isInteger(size) || size <= 0)
    throw new ApiError(411, "length_required", "Falta el tamaño del archivo");
  const tooLarge = () =>
    new ApiError(413, "too_large", `El archivo pesa demasiado: el máximo es ${formatFileSize(options.max)}.`);
  if (size > options.max) {
    request.raw.resume();
    throw tooLarge();
  }
  const key = `${options.folder}/${randomUUID()}.${type.ext}`;
  await files.put(
    key,
    checkedStream(request.body as Readable, { contentType, declaredSize: size, max: options.max, tooLarge }),
    size,
    contentType,
  );
  return { key, fileName: cleanFileName(rawName, type.ext), contentType, size };
}
