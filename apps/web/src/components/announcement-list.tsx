import { ANNOUNCEMENT_AUDIENCE_LABELS, type AnnouncementDto, formatDate, formatDay } from "@escolar/shared";
import type { ReactNode } from "react";

/** Lista de avisos del centro (para el personal o para las familias). */
export function AnnouncementList({
  items,
  showAudience = false,
  action,
}: {
  items: AnnouncementDto[];
  showAudience?: boolean;
  /** Botón por aviso (por ejemplo, «Quitar»). */
  action?: (item: AnnouncementDto) => ReactNode;
}) {
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-semibold text-slate-900">{a.title}</h3>
            {action?.(a)}
          </div>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{a.body}</p>
          <p className="mt-2 text-xs text-slate-500">
            {a.authorName} · {formatDate(a.createdAt)}
            {a.sectionLabel && ` · ${a.sectionLabel}`}
            {showAudience &&
              ` · ${ANNOUNCEMENT_AUDIENCE_LABELS[a.audience]} · hasta el ${formatDay(a.expiresOn)}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
