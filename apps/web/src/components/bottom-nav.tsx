"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, iconForHref } from "@/components/icons";
import { type NavItem, useUnreadMessages } from "@/components/nav";

/** Nombres cortos para la barra de abajo (no caben los del menú). */
const SHORT: Record<string, string> = {
  "/panel/alumnos": "Alumnos",
  "/panel/cuaderno": "Cuaderno",
  "/panel/aula": "Clases",
  "/panel/planificacion": "Planificar",
  "/panel/seguimiento": "Seguimiento",
  "/panel/pagos/familia": "Pagos",
  "/panel/pagos/mis-pagos": "Pagos",
  "/panel/mis-notas": "Notas",
  "/panel/familia": "Mis hijos",
};

/** Abre el menú lateral (MobileMenu lo escucha): «Más» en la barra de abajo. */
export const OPEN_MENU_EVENT = "conecta:abrir-menu";

/**
 * Barra de abajo en el celular, como en una app: las 4 opciones que cada quien más usa y «Más», que
 * abre el menú completo. En la computadora no se muestra (el menú lateral queda a la vista).
 */
export function BottomNav({ items, unreadMessages }: { items: NavItem[]; unreadMessages: number }) {
  const pathname = usePathname();
  const unread = useUnreadMessages(
    unreadMessages,
    items.some((i) => i.unreadBadge),
  );
  const matches = (href: string) => (href === "/panel" ? pathname === "/panel" : pathname.startsWith(href));
  const activeHref = items
    .map((i) => i.href as string)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav
      aria-label="Accesos rápidos"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.slice(0, 4).map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-medium ${
                  active ? "text-brand-700" : "text-slate-500"
                }`}
              >
                <span
                  className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-brand-50" : ""}`}
                >
                  <Icon name={iconForHref(item.href as string)} className="size-[22px]" />
                </span>
                <span className="max-w-full truncate">{SHORT[item.href as string] ?? item.label}</span>
                {item.unreadBadge && unread > 0 && (
                  <span className="absolute right-[22%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                    {unread > 9 ? "9+" : unread}
                    <span className="sr-only"> conversaciones sin leer</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_MENU_EVENT))}
            className="flex w-full flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[11px] font-medium text-slate-500"
          >
            <span className="grid h-7 w-12 place-items-center rounded-full">
              <Icon name="more" className="size-[22px]" />
            </span>
            Más
          </button>
        </li>
      </ul>
    </nav>
  );
}
