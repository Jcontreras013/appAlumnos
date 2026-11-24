import type { Readable } from "node:stream";
import { ApiError, checkedStream, contentDispositionFor } from "@escolar/service-kit";
import { ATTACHMENT_LABELS, type AttachmentKind, formatFileSize, type PushPayload } from "@escolar/shared";

/**
 * Revisión de lo que se sube a los mensajes (la lógica común está en service-kit/uploads): el contenido
 * tiene que ser lo que dice ser y no pasar del tamaño permitido para cada tipo de adjunto.
 */

export { parseRange } from "@escolar/service-kit";

export const tooLarge = (kind: AttachmentKind, max: number) =>
  new ApiError(
    413,
    "too_large",
    `${ATTACHMENT_LABELS[kind]} demasiado grande: el máximo es ${formatFileSize(max)}.`,
  );

export function checkedUpload(
  source: AsyncIterable<Buffer | string>,
  {
    contentType,
    declaredSize,
    kind,
    max,
  }: { contentType: string; declaredSize: number; kind: AttachmentKind; max: number },
): Readable {
  return checkedStream(source, { contentType, declaredSize, max, tooLarge: () => tooLarge(kind, max) });
}

/** `Content-Disposition` con el nombre original: fotos y videos se ven, los documentos se descargan. */
export const contentDisposition = (kind: AttachmentKind, name: string) =>
  contentDispositionFor(kind !== "archivo", name);

const SENT: Record<AttachmentKind, string> = {
  foto: "Te envió una foto.",
  video: "Te envió un video.",
  archivo: "Te envió un documento.",
};

/** Lo que dice el aviso; como siempre, sin el contenido. */
export const noticeText = (kind: AttachmentKind | null): PushPayload["body"] =>
  kind ? SENT[kind] : "Te envió un mensaje.";
