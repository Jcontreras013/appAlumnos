"use client";

import { type MessageContactDto, matchesSearch } from "@escolar/shared";
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { startConversationAction } from "@/app/panel/mensajes/actions";
import { Avatar } from "./conversation-list";
import { ROLE_SHORT } from "./format";

function ContactButton({ contact }: { contact: MessageContactDto }) {
  const { pending, data } = useFormStatus();
  const opening = pending && data?.get("userId") === contact.userId;
  return (
    <button
      type="submit"
      name="userId"
      value={contact.userId}
      disabled={pending}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50 disabled:opacity-60"
    >
      <Avatar name={contact.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{contact.name}</span>
        <span className="block text-xs text-slate-500">{ROLE_SHORT[contact.role]}</span>
      </span>
      {opening && <span className="text-xs text-slate-500">Abriendo…</span>}
    </button>
  );
}

/** Botón «Nuevo mensaje»: cuadro con el personal del centro y un buscador por nombre. */
export function NewConversation({ contacts }: { contacts: MessageContactDto[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const shown = contacts.filter((c) => matchesSearch(`${c.name} ${ROLE_SHORT[c.role]}`, query));
  const direction = shown.filter((c) => c.role === "admin");
  const teachers = shown.filter((c) => c.role !== "admin");

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => dialog.current?.showModal()}>
        Nuevo mensaje
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: el clic en el fondo es un atajo; con teclado se cierra con Esc, que <dialog> ya trae */}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
        className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="space-y-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                ¿A quién le escribes?
              </h2>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="btn-secondary shrink-0 px-3 py-1.5"
              >
                Cerrar
              </button>
            </div>
            <label htmlFor={`${titleId}-buscar`} className="sr-only">
              Buscar por nombre
            </label>
            <input
              id={`${titleId}-buscar`}
              type="search"
              className="input"
              placeholder="Buscar por nombre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <form action={startConversationAction} className="overflow-y-auto pb-2">
            {contacts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">
                Todavía no hay otros maestros ni dirección con acceso al panel en este centro.
              </p>
            ) : shown.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nadie coincide con «{query}».</p>
            ) : (
              [
                { title: "Dirección", people: direction },
                { title: "Maestros", people: teachers },
              ]
                .filter((group) => group.people.length > 0)
                .map((group) => (
                  <div key={group.title}>
                    <p className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {group.title}
                    </p>
                    {group.people.map((c) => (
                      <ContactButton key={c.userId} contact={c} />
                    ))}
                  </div>
                ))
            )}
          </form>
        </div>
      </dialog>
    </>
  );
}
