"use client";

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  type AttachmentKind,
  attachmentTypeOf,
  formatFileSize,
  type MessageDto,
  PHOTO_MAX_SIDE,
  VIDEO_MAX_SECONDS,
} from "@escolar/shared";

/** Un archivo listo para enviar: las fotos ya achicadas en el teléfono. */
export interface PreparedFile {
  /** Para distinguirlo en la lista mientras se elige. */
  id: string;
  blob: Blob;
  name: string;
  type: string;
  kind: AttachmentKind;
  /** Vista previa local (fotos y videos) mientras se elige o se envía. */
  preview: string | null;
}

/** Lo que se puede elegir con cada botón. */
export const PICK_MEDIA = "image/*,video/*";
export const PICK_DOCUMENTS = Object.entries(ATTACHMENT_TYPES)
  .filter(([, t]) => t.kind === "archivo")
  .flatMap(([mime, t]) => [mime, `.${t.ext}`])
  .join(",");

const DOCUMENT_HINT = "fotos, videos o documentos PDF, Word, Excel o PowerPoint";

/**
 * Achica la foto a {PHOTO_MAX_SIDE} px por lado y la guarda como JPEG: pesa una fracción (gasta menos
 * datos) y de paso se le quitan los datos ocultos de la cámara, como la ubicación.
 */
async function shrinkPhoto(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.82));
  } catch {
    return null;
  }
}

/** Duración del video en segundos (null si el navegador no la puede leer). */
function videoSeconds(url: string): Promise<number | null> {
  return new Promise((done) => {
    const video = document.createElement("video");
    const finish = (value: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      done(value);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

let sequence = 0;
/** Id local (crypto.randomUUID no existe si se entra por http a una IP de la red). */
const nextId = () => `archivo-${++sequence}`;

const withExtension = (name: string, ext: string) => `${name.replace(/\.[^.]+$/, "") || "foto"}.${ext}`;

/** Revisa y prepara un archivo elegido; si no se puede enviar, dice por qué. */
export async function prepareFile(file: File): Promise<PreparedFile | { error: string }> {
  if (file.type.startsWith("image/")) {
    const photo = await shrinkPhoto(file);
    if (!photo) return { error: `No se pudo leer la foto «${file.name}». Prueba con otra.` };
    if (photo.size > ATTACHMENT_MAX_BYTES.foto)
      return { error: `La foto «${file.name}» es demasiado grande.` };
    return {
      id: nextId(),
      blob: photo,
      name: withExtension(file.name, "jpg"),
      type: "image/jpeg",
      kind: "foto",
      preview: URL.createObjectURL(photo),
    };
  }
  const type = attachmentTypeOf(file.name, file.type);
  const info = type ? ATTACHMENT_TYPES[type] : undefined;
  if (!type || !info) return { error: `«${file.name}» no se puede enviar: solo ${DOCUMENT_HINT}.` };
  const max = ATTACHMENT_MAX_BYTES[info.kind];
  if (file.size > max) {
    return {
      error: `«${file.name}» pesa ${formatFileSize(file.size)}: el máximo es ${formatFileSize(max)}.${
        info.kind === "video" ? " Graba uno más corto." : ""
      }`,
    };
  }
  if (info.kind === "video") {
    const preview = URL.createObjectURL(file);
    const seconds = await videoSeconds(preview);
    if (seconds !== null && seconds > VIDEO_MAX_SECONDS + 1) {
      URL.revokeObjectURL(preview);
      return { error: `El video dura más de ${VIDEO_MAX_SECONDS} segundos. Graba uno más corto.` };
    }
    return { id: nextId(), blob: file, name: file.name, type, kind: "video", preview };
  }
  return { id: nextId(), blob: file, name: file.name, type, kind: "archivo", preview: null };
}

export type UploadResult = { ok: true; message: MessageDto } | { ok: false; error: string };

/** Renueva la sesión si está por vencer (las rutas del panel lo hacen solas al consultarlas). */
async function refreshSession() {
  await fetch("/panel/mensajes/no-leidos", { cache: "no-store" }).catch(() => {});
}

function send(conversationId: string, file: PreparedFile, onProgress: (fraction: number) => void) {
  return new Promise<{ status: number; body: unknown }>((done) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/mensajes/${conversationId}/adjuntos`);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // respuesta sin JSON
      }
      done({ status: xhr.status, body });
    };
    xhr.onerror = () => done({ status: 0, body: null });
    xhr.send(file.blob);
  });
}

/** Sube el archivo como mensaje, con el avance para la barra. Si la sesión venció, la renueva y reintenta. */
export async function uploadAttachment(
  conversationId: string,
  file: PreparedFile,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  let res = await send(conversationId, file, onProgress);
  if (res.status === 401) {
    await refreshSession();
    res = await send(conversationId, file, onProgress);
  }
  if (res.status === 201) return { ok: true, message: res.body as MessageDto };
  if (res.status === 0) return { ok: false, error: "No se envió. Revisa tu conexión e intenta de nuevo." };
  if (res.status === 401) {
    window.location.reload();
    return { ok: false, error: "Tu sesión venció." };
  }
  const message = (res.body as { error?: { message?: string } } | null)?.error?.message;
  return { ok: false, error: message ?? "No se pudo enviar el archivo." };
}

export { refreshSession };
