import { CLASS_FILE_TYPES, type ClassMaterialDto, formatFileSize } from "@escolar/shared";

const fileUrl = (id: string) => `/panel/aula/archivo/${id}`;

/** Un material de un tema: el video se ve ahí mismo; la imagen, en miniatura; el resto, como enlace. */
export function MaterialView({ material }: { material: ClassMaterialDto }) {
  if (material.kind === "video" && material.youtubeId) {
    return (
      <figure className="max-w-2xl space-y-1">
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${material.youtubeId}`}
            title={material.title}
            className="h-full w-full"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
        <figcaption className="text-xs text-slate-500">{material.title}</figcaption>
      </figure>
    );
  }
  if (material.kind === "archivo" && material.file) {
    const image = material.file.contentType.startsWith("image/");
    const label = CLASS_FILE_TYPES[material.file.contentType]?.label ?? "Archivo";
    if (image) {
      return (
        <a href={fileUrl(material.id)} target="_blank" rel="noopener" className="block w-fit">
          {/* biome-ignore lint/performance/noImgElement: la imagen la entrega el servicio con su sesión */}
          <img
            src={fileUrl(material.id)}
            alt={material.title}
            loading="lazy"
            className="max-h-72 rounded-lg border border-slate-200"
          />
          <span className="mt-1 block text-xs text-slate-500">{material.title}</span>
        </a>
      );
    }
    return (
      <a
        href={fileUrl(material.id)}
        target="_blank"
        rel="noopener"
        className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-50 text-xs font-bold text-brand-700">
          {label === "PDF" ? "PDF" : label.slice(0, 3).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{material.title}</span>
          <span className="block text-xs text-slate-500">
            {label} · {formatFileSize(material.file.size)}
          </span>
        </span>
      </a>
    );
  }
  return (
    <a
      href={material.url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sky-50 text-sm font-bold text-sky-700">
        ↗
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{material.title}</span>
        <span className="block truncate text-xs text-slate-500">{material.url}</span>
      </span>
    </a>
  );
}
