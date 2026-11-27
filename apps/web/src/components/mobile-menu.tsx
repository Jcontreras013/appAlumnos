"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { OPEN_MENU_EVENT } from "@/components/bottom-nav";
import { Nav, type NavItem, type UpcomingItem } from "@/components/nav";

/**
 * Menú del celular: un botón (☰) abre la barra lateral desde la izquierda, como en una app. Se cierra
 * al elegir una opción, al tocar fuera o con «Esc». En la computadora la barra queda siempre a la vista.
 */
export function MobileMenu({
  items,
  upcoming,
  unreadMessages,
  brand,
  who,
  footer,
}: {
  items: NavItem[];
  upcoming: UpcomingItem[];
  unreadMessages: number;
  /** Logo y nombre de la plataforma, arriba del menú. */
  brand: ReactNode;
  /** Quién entró (nombre y cargo). */
  who: ReactNode;
  /** «Mi cuenta» y «Cerrar sesión», al pie. */
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Al cambiar de página, el menú se cierra solo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: se cierra cada vez que cambia la página
  useEffect(() => setOpen(false), [pathname]);

  // «Más» en la barra de abajo también abre el menú.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_MENU_EVENT, show);
    return () => window.removeEventListener(OPEN_MENU_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // La página de atrás no se desplaza mientras el menú está abierto.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir el menú"
        aria-expanded={open}
        aria-controls="menu-lateral"
        className="relative -ml-1 grid size-10 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        {unreadMessages > 0 && (
          <span className="absolute right-1 top-1 size-2.5 rounded-full bg-brand-600 ring-2 ring-white">
            <span className="sr-only">Hay mensajes sin leer</span>
          </span>
        )}
      </button>

      <div className={`fixed inset-0 z-40 md:hidden ${open ? "" : "pointer-events-none"}`}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Cerrar el menú"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <div
          id="menu-lateral"
          role="dialog"
          aria-modal="true"
          aria-label="Menú"
          inert={!open}
          className={`absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-white shadow-2xl transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-4">
            {brand}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar el menú"
              className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="border-b border-slate-100 px-5 py-3 text-sm">{who}</div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <Nav items={items} upcoming={upcoming} unreadMessages={unreadMessages} vertical />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
            {footer}
          </div>
        </div>
      </div>
    </>
  );
}
