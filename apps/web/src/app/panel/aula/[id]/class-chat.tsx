"use client";

import { CLASS_CHAT_MAX_LENGTH, type ClassChatDto } from "@escolar/shared";
import { useEffect, useRef, useState, useTransition } from "react";
import { fetchPanelJson, usePoll } from "@/components/messages/use-poll";
import { deleteClassChatAction, sendClassChatAction, setClassChatAction } from "../actions";

const time = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  }).format(new Date(iso));

/**
 * Chat de toda la clase: el maestro y los alumnos de la sección. Se actualiza solo cada pocos
 * segundos mientras la página está a la vista. El maestro lo abre o lo cierra y puede borrar mensajes.
 */
export function ClassChat({ assignmentId, initial }: { assignmentId: string; initial: ClassChatDto }) {
  const [chat, setChat] = useState(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = useRef<HTMLOListElement>(null);
  const reload = async () => {
    const data = await fetchPanelJson<ClassChatDto>(`/panel/aula/${assignmentId}/chat`);
    if (data) setChat(data);
  };
  usePoll(reload, 5_000);
  const count = chat.messages.length;
  // Baja al último mensaje cuando llega uno nuevo.
  useEffect(() => {
    if (count && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const res = await sendClassChatAction(assignmentId, body);
      if (res.error) setError(res.error);
      else {
        setText("");
        setError(null);
        await reload();
      }
    });
  };
  const remove = (id: string) =>
    start(async () => {
      const res = await deleteClassChatAction(id);
      if (res.error) setError(res.error);
      await reload();
    });
  const toggle = () =>
    start(async () => {
      const res = await setClassChatAction(assignmentId, !chat.enabled);
      if (res.error) setError(res.error);
      await reload();
    });

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Chat de la clase{" "}
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs ${chat.enabled ? "bg-brand-50 text-brand-700" : "bg-slate-200 text-slate-600"}`}
          >
            {chat.enabled ? "Abierto" : "Cerrado"}
          </span>
        </h2>
        {chat.canModerate && (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            {chat.enabled ? "Cerrar el chat" : "Abrir el chat"}
          </button>
        )}
      </div>
      {!chat.enabled && chat.messages.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          {chat.canModerate
            ? "Ábrelo para que la clase converse contigo en un solo lugar. Tú puedes borrar mensajes y cerrarlo cuando quieras."
            : "El maestro todavía no abrió el chat de la clase."}
        </p>
      ) : (
        <ol ref={list} className="max-h-96 space-y-2 overflow-y-auto px-4 py-3">
          {chat.messages.map((m) => (
            <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  m.mine
                    ? "bg-brand-600 text-white"
                    : m.authorRole === "maestro"
                      ? "border border-amber-200 bg-amber-50 text-slate-900"
                      : "bg-slate-100 text-slate-900"
                }`}
              >
                {!m.mine && (
                  <p className="text-xs font-semibold">
                    {m.authorName}
                    {m.authorRole === "maestro" && " · Maestro"}
                  </p>
                )}
                {m.body === null ? (
                  <p className="italic opacity-70">Mensaje borrado</p>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                )}
                <p
                  className={`mt-1 flex items-center gap-2 text-[11px] ${m.mine ? "text-brand-100" : "text-slate-500"}`}
                >
                  {time(m.createdAt)}
                  {m.body !== null && (m.mine || chat.canModerate) && (
                    <button
                      type="button"
                      onClick={() => remove(m.id)}
                      disabled={pending}
                      className="underline hover:no-underline"
                    >
                      Borrar
                    </button>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="px-4 pb-2 text-sm text-red-700">{error}</p>}
      {chat.canWrite && (
        <form
          className="flex gap-2 border-t border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor={`chat-${assignmentId}`} className="sr-only">
            Mensaje para la clase
          </label>
          <input
            id={`chat-${assignmentId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={CLASS_CHAT_MAX_LENGTH}
            placeholder="Escribe a la clase"
            className="input flex-1"
            autoComplete="off"
          />
          <button type="submit" className="btn-primary px-4" disabled={pending || !text.trim()}>
            Enviar
          </button>
        </form>
      )}
    </section>
  );
}
