"use client";

import type { UnreadMessagesDto } from "@escolar/shared";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";
import { fetchPanelJson, usePoll } from "@/components/messages/use-poll";

export interface NavItem {
  href: Route;
  label: string;
  /** Muestra el contador de conversaciones sin leer (se actualiza solo). */
  unreadBadge?: boolean;
  /** Título de la sección del menú (Mis clases, Alumnos, Personal, El centro). */
  group?: string;
  /** Un número fijo al lado (por ejemplo, solicitudes por confirmar). */
  badge?: number;
}

/** Contador de mensajes sin leer: se consulta cada medio minuto mientras el panel está a la vista. */
function useUnreadMessages(initial: number, enabled: boolean) {
  const [count, setCount] = useState(initial);
  usePoll(async () => {
    if (!enabled) return;
    const data = await fetchPanelJson<UnreadMessagesDto>("/panel/mensajes/no-leidos");
    if (data) setCount(data.conversations);
  }, 30_000);
  return count;
}

export interface UpcomingItem {
  label: string;
  phase: number;
}

export function Nav({
  items,
  upcoming,
  unreadMessages = 0,
  vertical = false,
}: {
  items: NavItem[];
  upcoming: UpcomingItem[];
  unreadMessages?: number;
  /** Siempre en columna con sus secciones (el menú lateral del celular). */
  vertical?: boolean;
}) {
  const pathname = usePathname();
  const unread = useUnreadMessages(
    unreadMessages,
    items.some((i) => i.unreadBadge),
  );
  // La opción más específica que coincide: en /panel/region/indicadores se marca "Indicadores", no
  // también "Tablero de centros".
  const matches = (href: string) => (href === "/panel" ? pathname === "/panel" : pathname.startsWith(href));
  const activeHref = items
    .map((i) => i.href as string)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav
      aria-label="Principal"
      className={
        vertical ? "flex flex-col gap-1" : "flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
      }
    >
      {items.map((item, i) => {
        const active = item.href === activeHref;
        const heading = item.group && item.group !== items[i - 1]?.group ? item.group : null;
        return (
          <Fragment key={item.href}>
            {heading && (
              <p
                className={`px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400 ${vertical ? "block" : "hidden md:block"}`}
              >
                {heading}
              </p>
            )}
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {item.label}
              {Boolean(item.badge) && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
                  {item.badge}
                  <span className="sr-only"> por confirmar</span>
                </span>
              )}
              {item.unreadBadge && unread > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                  <span className="sr-only"> conversaciones sin leer</span>
                </span>
              )}
            </Link>
          </Fragment>
        );
      })}
      {upcoming.length > 0 && (
        <div className={vertical ? "mt-6" : "hidden md:mt-6 md:block"}>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Próximamente
          </p>
          {upcoming.map((item) => (
            <span
              key={item.label}
              className="flex items-center justify-between px-3 py-2 text-sm text-slate-400"
              title={`Llega en la fase ${item.phase}`}
            >
              {item.label}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold">
                F{item.phase}
              </span>
            </span>
          ))}
        </div>
      )}
    </nav>
  );
}
