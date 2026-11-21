"use client";

import { type AttachmentDto, type AttachmentKind, formatFileSize } from "@escolar/shared";

export const attachmentUrl = (id: string) => `/panel/mensajes/adjuntos/${id}`;

/** Ícono de documento con la extensión (PDF, DOCX…). */
export function FileBadge({ name }: { name: string }) {
  const ext = (name.split(".").pop() ?? "").slice(0, 4).toUpperCase();
  const color = ext.startsWith("PDF")
    ? "bg-red-600"
    : ext.startsWith("XLS")
      ? "bg-emerald-700"
      : ext.startsWith("PPT")
        ? "bg-orange-600"
        : "bg-blue-700";
  return (
    <span
      aria-hidden="true"
      className={`grid h-10 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white ${color}`}
    >
      {ext || "DOC"}
    </span>
  );
}

/** La foto, el video o el documento dentro de la burbuja. */
export function AttachmentView({ attachment, onLoad }: { attachment: AttachmentDto; onLoad?: () => void }) {
  const url = attachmentUrl(attachment.id);
  if (attachment.kind === "foto") {
    return (
      <a href={url} target="_blank" rel="noopener" className="block" title="Ver la foto completa">
        {/* biome-ignore lint/performance/noImgElement: la foto llega del servicio con la sesión; no pasa por el optimizador. */}
        <img
          src={url}
          alt={attachment.name}
          loading="lazy"
          onLoad={onLoad}
          className="max-h-80 w-auto max-w-full rounded-xl bg-slate-100 object-contain"
        />
      </a>
    );
  }
  if (attachment.kind === "video") {
    return (
      <div>
        {/* biome-ignore lint/a11y/useMediaCaption: videos que graban maestros y dirección, sin subtítulos. */}
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={onLoad}
          className="max-h-80 max-w-full rounded-xl bg-black"
        />
        <a href={url} download={attachment.name} className="mt-1 block text-xs text-slate-500 underline">
          Descargar video ({formatFileSize(attachment.size)})
        </a>
      </div>
    );
  }
  return (
    <a
      href={url}
      download={attachment.name}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-800 hover:bg-slate-50"
    >
      <FileBadge name={attachment.name} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.name}</span>
        <span className="block text-xs text-slate-500">{formatFileSize(attachment.size)} · Descargar</span>
      </span>
    </a>
  );
}

const PREVIEW_LABEL: Record<AttachmentKind, string> = { foto: "Foto", video: "Video", archivo: "Documento" };

/** Texto del último mensaje en la lista de conversaciones. */
export function attachmentPreview(attachment: { kind: AttachmentKind; name: string }) {
  return attachment.kind === "archivo"
    ? `📄 ${attachment.name}`
    : `${attachment.kind === "foto" ? "📷" : "🎬"} ${PREVIEW_LABEL[attachment.kind]}`;
}
