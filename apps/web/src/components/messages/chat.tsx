"use client";

import { type ConversationDto, MESSAGE_MAX_LENGTH, type MessageDto } from "@escolar/shared";
import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type SendResult, sendMessageAction } from "@/app/panel/mensajes/actions";
import { Avatar } from "./conversation-list";
import { dayKey, dayLabel, messageTime, notifyMessagesChanged, ROLE_SHORT } from "./format";
import { fetchPanelJson, usePoll } from "./use-poll";

/** Mensaje que salió de este teléfono y todavía no confirma el servidor. */
interface Pending {
  localId: string;
  body: string;
  sentAt: string;
  status: "sending" | "failed";
  error?: string;
}

const byTime = (a: MessageDto, b: MessageDto) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id);
/** A menos de esto del final, los mensajes nuevos bajan la vista solos. */
const NEAR_BOTTOM_PX = 120;

function Ticks({ seen }: { seen: boolean }) {
  return seen ? (
    <span className="font-semibold text-brand-700" title="Visto">
      <span aria-hidden="true">✓✓</span>
      <span className="sr-only">Visto</span>
    </span>
  ) : (
    <span title="Enviado">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">Enviado</span>
    </span>
  );
}

function Bubble({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          mine
            ? "rounded-br-md bg-brand-100 text-slate-900"
            : "rounded-bl-md border border-slate-200 bg-white text-slate-900"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** Conversación tipo chat: se actualiza sola cada pocos segundos mientras está a la vista. */
export function Chat({ initial }: { initial: ConversationDto }) {
  const id = initial.id;
  const [messages, setMessages] = useState<MessageDto[]>(initial.messages);
  const [pending, setPending] = useState<Pending[]>([]);
  const [hasOlder, setHasOlder] = useState(initial.hasOlder);
  const [other, setOther] = useState(initial.other);
  const [canSend, setCanSend] = useState(initial.canSend);
  const [draft, setDraft] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const [online, setOnline] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  /** Al traer mensajes anteriores: altura de antes, para no mover lo que se estaba leyendo. */
  const keepFrom = useRef<number | null>(null);
  const lastCount = useRef(0);
  const localIds = useRef(0);
  const coarsePointer = useRef(false);
  const known = useRef(new Set(initial.messages.map((m) => m.id)));

  const merge = (incoming: MessageDto[]) => {
    for (const m of incoming) known.current.add(m.id);
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort(byTime);
    });
  };

  useEffect(() => {
    coarsePointer.current = window.matchMedia("(pointer: coarse)").matches;
    // La página ya marcó como leídos los mensajes al abrirse: que el menú y la lista lo sepan.
    notifyMessagesChanged();
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  usePoll(async () => {
    const data = await fetchPanelJson<ConversationDto>(`/panel/mensajes/${id}/datos?leer=1`);
    if (!data) return;
    const arrived = data.messages.some((m) => !m.mine && !known.current.has(m.id));
    merge(data.messages);
    setOther(data.other);
    setCanSend(data.canSend);
    if (arrived) notifyMessagesChanged();
  }, 4_000);

  // Mantiene la vista abajo cuando llegan mensajes, salvo que la persona esté leyendo más arriba.
  const total = messages.length + pending.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop += el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (lastCount.current === 0 || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (total > lastCount.current) {
      setNewBelow(true);
    }
    lastCount.current = total;
  }, [total]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom.current) setNewBelow(false);
  };

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewBelow(false);
  };

  async function loadOlder() {
    const first = messages[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await fetchPanelJson<ConversationDto>(`/panel/mensajes/${id}/datos?antes=${first.id}`);
      if (data) {
        keepFrom.current = scroller.current?.scrollHeight ?? null;
        merge(data.messages);
        setHasOlder(data.hasOlder);
      }
    } finally {
      setLoadingOlder(false);
    }
  }

  function resize() {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function send(text: string, retry?: Pending) {
    const body = text.trim();
    if (!body) return;
    const localId = retry?.localId ?? `local-${++localIds.current}`;
    if (retry) {
      setPending((list) =>
        list.map((p) => (p.localId === localId ? { ...p, status: "sending", error: undefined } : p)),
      );
    } else {
      setPending((list) => [...list, { localId, body, sentAt: new Date().toISOString(), status: "sending" }]);
      setDraft("");
      requestAnimationFrame(resize);
    }
    nearBottom.current = true;
    let result: SendResult;
    try {
      result = await sendMessageAction(id, body);
    } catch {
      result = { ok: false, error: "No se envió. Revisa tu conexión e intenta de nuevo." };
    }
    if (result.ok) {
      setPending((list) => list.filter((p) => p.localId !== localId));
      merge([result.message]);
      notifyMessagesChanged();
    } else {
      const error = result.error;
      setPending((list) => list.map((p) => (p.localId === localId ? { ...p, status: "failed", error } : p)));
    }
  }

  const firstName = other.name.split(/\s+/)[0] ?? other.name;
  let previousDay = "";

  return (
    <section className="card flex h-[calc(100dvh-14.5rem)] min-h-[24rem] flex-col overflow-hidden md:h-[calc(100dvh-12rem)]">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <Link
          href="/panel/mensajes"
          className="btn-secondary px-2.5 py-1.5 md:hidden"
          aria-label="Volver a mensajes"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <Avatar name={other.name} muted={other.role === null} />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900">{other.name}</h1>
          <p className="text-xs text-slate-500">
            {other.role ? ROLE_SHORT[other.role] : "Ya no está en el centro"}
          </p>
        </div>
      </header>

      {!online && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Sin internet. Los mensajes nuevos llegarán cuando vuelva la señal.
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          role="log"
          aria-label={`Mensajes con ${other.name}`}
          className="h-full space-y-2 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5"
        >
          {hasOlder && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-xs"
                onClick={loadOlder}
                disabled={loadingOlder}
              >
                {loadingOlder ? "Cargando…" : "Ver mensajes anteriores"}
              </button>
            </div>
          )}
          {messages.length === 0 && pending.length === 0 && (
            <p className="mx-auto max-w-sm py-10 text-center text-sm text-slate-500">
              Escríbele el primer mensaje a {firstName}. Lo que se escribe aquí queda guardado y no se borra.
            </p>
          )}
          {messages.map((m) => {
            const day = dayKey(m.sentAt);
            const separator = day !== previousDay;
            previousDay = day;
            return (
              <Fragment key={m.id}>
                {separator && (
                  <p className="py-2 text-center">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
                      {dayLabel(m.sentAt)}
                    </span>
                  </p>
                )}
                <Bubble mine={m.mine}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-500">
                    {messageTime(m.sentAt)}
                    {m.mine && <Ticks seen={m.seen} />}
                  </p>
                </Bubble>
              </Fragment>
            );
          })}
          {pending.map((p) => (
            <Bubble key={p.localId} mine>
              <p className="whitespace-pre-wrap break-words">{p.body}</p>
              {p.status === "sending" ? (
                <p className="mt-1 text-right text-[11px] text-slate-500">Enviando…</p>
              ) : (
                <div className="mt-1 space-y-1 text-right text-xs">
                  <p className="font-medium text-red-700">{p.error ?? "No se envió"}</p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="font-semibold text-brand-700 underline"
                      onClick={() => void send(p.body, p)}
                    >
                      Reintentar
                    </button>
                    <button
                      type="button"
                      className="text-slate-500 underline"
                      onClick={() => setPending((list) => list.filter((x) => x.localId !== p.localId))}
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              )}
            </Bubble>
          ))}
        </div>
        {newBelow && (
          <button
            type="button"
            onClick={toBottom}
            className="-translate-x-1/2 absolute bottom-3 left-1/2 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md"
          >
            Mensajes nuevos ↓
          </button>
        )}
      </div>

      {canSend ? (
        <form
          className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor={`mensaje-${id}`} className="sr-only">
            Escribe un mensaje
          </label>
          <div className="min-w-0 flex-1">
            <textarea
              id={`mensaje-${id}`}
              ref={textarea}
              rows={1}
              value={draft}
              maxLength={MESSAGE_MAX_LENGTH}
              placeholder="Escribe un mensaje"
              className="input max-h-40 resize-none"
              onChange={(e) => {
                setDraft(e.target.value);
                resize();
              }}
              onKeyDown={(e) => {
                // En la computadora, Enter envía (Shift+Enter baja de línea). En el teléfono, Enter baja de línea.
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !coarsePointer.current &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            {draft.length > MESSAGE_MAX_LENGTH - 200 && (
              <p className="mt-1 text-right text-xs text-slate-500">
                {draft.length}/{MESSAGE_MAX_LENGTH}
              </p>
            )}
          </div>
          <button type="submit" className="btn-primary shrink-0" disabled={!draft.trim()}>
            Enviar
          </button>
        </form>
      ) : (
        <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {other.name} ya no trabaja en el centro. Puedes leer la conversación, pero ya no se le pueden mandar
          mensajes.
        </p>
      )}
    </section>
  );
}
