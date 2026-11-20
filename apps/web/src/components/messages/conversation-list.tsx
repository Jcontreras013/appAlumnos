"use client";

import { type ConversationSummaryDto, matchesSearch } from "@escolar/shared";
import Link from "next/link";
import { useState } from "react";
import { attachmentPreview } from "./attachment-view";
import { initials, listTime, ROLE_SHORT } from "./format";
import { fetchPanelJson, usePoll } from "./use-poll";

/** Con más conversaciones que esto aparece el buscador. */
const SEARCH_FROM = 6;

export function Avatar({ name, muted = false }: { name: string; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${
        muted ? "bg-slate-100 text-slate-400" : "bg-brand-50 text-brand-700"
      }`}
    >
      {initials(name) || "?"}
    </span>
  );
}

/** Mis conversaciones, la más reciente arriba. Se actualiza sola mientras está a la vista. */
export function ConversationList({
  initial,
  activeId,
}: {
  initial: ConversationSummaryDto[];
  activeId?: string;
}) {
  const [items, setItems] = useState(initial);
  const [query, setQuery] = useState("");
  usePoll(async () => {
    const next = await fetchPanelJson<ConversationSummaryDto[]>("/panel/mensajes/lista");
    if (next) setItems(next);
  }, 15_000);

  const shown = items.filter((c) => matchesSearch(c.other.name, query));
  return (
    <section aria-label="Conversaciones" className="card flex min-h-0 flex-col overflow-hidden">
      {items.length >= SEARCH_FROM && (
        <div className="border-b border-slate-200 p-3">
          <label htmlFor="buscar-conversacion" className="sr-only">
            Buscar conversación
          </label>
          <input
            id="buscar-conversacion"
            type="search"
            className="input"
            placeholder="Buscar por nombre…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {items.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">
          Todavía no tienes conversaciones. Toca «Nuevo mensaje» para escribirle a un compañero o a la
          dirección.
        </p>
      ) : shown.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">Nadie coincide con «{query}».</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {shown.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <Link
                  href={`/panel/mensajes/${c.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-3 transition ${
                    active ? "bg-brand-50" : "hover:bg-slate-50"
                  }`}
                >
                  <Avatar name={c.other.name} muted={c.other.role === null} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm ${c.unread ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}
                      >
                        {c.other.name}
                      </span>
                      {c.lastMessage && (
                        <span
                          className={`shrink-0 text-xs ${c.unread ? "font-semibold text-brand-700" : "text-slate-400"}`}
                        >
                          {listTime(c.lastMessage.sentAt)}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? "text-slate-700" : "text-slate-500"}`}>
                        {c.lastMessage
                          ? `${c.lastMessage.mine ? "Tú: " : ""}${
                              c.lastMessage.attachment
                                ? attachmentPreview(c.lastMessage.attachment)
                                : c.lastMessage.body
                            }`
                          : ""}
                      </span>
                      {c.unread > 0 && (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                          {c.unread > 99 ? "99+" : c.unread}
                          <span className="sr-only"> sin leer</span>
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {c.other.role ? ROLE_SHORT[c.other.role] : "Ya no está en el centro"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
