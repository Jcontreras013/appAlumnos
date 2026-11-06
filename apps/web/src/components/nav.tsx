"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: Route;
  label: string;
}

export interface UpcomingItem {
  label: string;
  phase: number;
}

export function Nav({ items, upcoming }: { items: NavItem[]; upcoming: UpcomingItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((item) => {
        const active = item.href === "/panel" ? pathname === "/panel" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      {upcoming.length > 0 && (
        <div className="hidden md:mt-6 md:block">
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
