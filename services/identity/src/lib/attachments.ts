import { Readable } from "node:stream";
import { ApiError } from "@escolar/service-kit";
import { ATTACHMENT_LABELS, type AttachmentKind, formatFileSize, type PushPayload } from "@escolar/shared";

/**
 * Revisión de lo que se sube a los mensajes: el contenido tiene que ser lo que dice ser (una foto que
 * empieza como foto, un PDF que empieza como PDF…) y no pasar del tamaño permitido. Así nadie manda un
 * programa con nombre de documento.
 */

const ascii = (s: string) => Buffer.from(s, "latin1");
const at = (offset: number, bytes: Buffer) => (head: Buffer) =>
  head.length >= offset + bytes.length && head.subarray(offset, offset + bytes.length).equals(bytes);

const JPEG = at(0, Buffer.from([0xff, 0xd8, 0xff]));
const PNG = at(0, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const WEBP = (h: Buffer) => at(0, ascii("RIFF"))(h) && at(8, ascii("WEBP"))(h);
/** MP4, MOV y 3GP: cajas ISO; la primera suele ser "ftyp" (en MOV viejos, otras cajas). */
const ISO_BOX = (boxes: string[]) => (h: Buffer) => boxes.some((b) => at(4, ascii(b))(h));
const WEBM = at(0, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
const PDF = at(0, ascii("%PDF"));
/** Word, Excel y PowerPoint nuevos son ZIP; los viejos, documentos OLE. */
const ZIP = at(0, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
const OLE = at(0, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
  "image/jpeg": JPEG,
  "image/png": PNG,
  "image/webp": WEBP,
  "video/mp4": ISO_BOX(["ftyp"]),
  "video/3gpp": ISO_BOX(["ftyp"]),
  "video/quicktime": ISO_BOX(["ftyp", "moov", "wide", "mdat", "free", "skip"]),
  "video/webm": WEBM,
  "application/pdf": PDF,
  "application/msword": OLE,
  "application/vnd.ms-excel": OLE,
  "application/vnd.ms-powerpoint": OLE,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ZIP,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ZIP,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ZIP,
};
const HEAD_BYTES = 16;

export const tooLarge = (kind: AttachmentKind, max: number) =>
  new ApiError(
    413,
    "too_large",
    `${ATTACHMENT_LABELS[kind]} demasiado grande: el máximo es ${formatFileSize(max)}.`,
  );
const notWhatItSays = () =>
  new ApiError(
    415,
    "unsupported_media",
    "El archivo no es del tipo que dice ser. Revisa que no esté dañado.",
  );

/**
 * El contenido subido, revisado mientras pasa: corta si se pasa del tamaño anunciado o del máximo, y
 * revisa los primeros bytes contra el tipo. No guarda el archivo completo en memoria.
 */
export function checkedUpload(
  source: AsyncIterable<Buffer | string>,
  {
    contentType,
    declaredSize,
    kind,
    max,
  }: { contentType: string; declaredSize: number; kind: AttachmentKind; max: number },
): Readable {
  const found = SIGNATURES[contentType];
  if (!found) throw notWhatItSays();
  const signature = found;
  async function* run() {
    let total = 0;
    let head = Buffer.alloc(0);
    let checked = false;
    for await (const raw of source) {
      const chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
      total += chunk.length;
      if (total > max) throw tooLarge(kind, max);
      if (total > declaredSize)
        throw new ApiError(400, "bad_request", "El archivo llegó más grande de lo anunciado");
      if (!checked) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= HEAD_BYTES) {
          if (!signature(head)) throw notWhatItSays();
          checked = true;
        }
      }
      yield chunk;
    }
    if (!checked && !signature(head)) throw notWhatItSays();
    if (total !== declaredSize)
      throw new ApiError(400, "bad_request", "El archivo llegó incompleto. Inténtalo de nuevo.");
  }
  return Readable.from(run());
}

/** Un tramo pedido con `Range: bytes=a-b` (uno solo, como piden los navegadores para los videos). */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, a, b] = match;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    // Los últimos N bytes.
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

/** `Content-Disposition` con el nombre original (también con tildes y ñ). */
export function contentDisposition(kind: AttachmentKind, name: string): string {
  const type = kind === "archivo" ? "attachment" : "inline";
  const plain = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const SENT: Record<AttachmentKind, string> = {
  foto: "Te envió una foto.",
  video: "Te envió un video.",
  archivo: "Te envió un documento.",
};

/** Lo que dice el aviso; como siempre, sin el contenido. */
export const noticeText = (kind: AttachmentKind | null): PushPayload["body"] =>
  kind ? SENT[kind] : "Te envió un mensaje.";
