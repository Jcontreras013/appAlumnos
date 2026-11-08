import { ROLE_LABELS, type Role } from "@escolar/shared";
import type { ReactNode } from "react";
import { Nav, type NavItem } from "@/components/nav";
import { APP_NAME } from "@/lib/brand";
import { getSession } from "@/lib/dal";
import { MODULES } from "@/lib/modules";
import { logoutAction } from "./actions";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { user, school } = await getSession();

  const items: NavItem[] = [{ href: "/panel", label: "Inicio" }];
  const is = (...roles: Role[]) => roles.includes(user.role);
  if (is("superadmin")) items.push({ href: "/panel/colegios", label: "Colegios" });
  if (is("admin", "secretaria", "coordinador")) items.push({ href: "/panel/alumnos", label: "Alumnos" });
  if (is("admin", "coordinador", "secretaria"))
    items.push({ href: "/panel/estructura", label: "Estructura académica" });
  if (is("admin")) items.push({ href: "/panel/usuarios", label: "Usuarios" });
  const upcoming = MODULES.filter((m) => !m.href && m.roles.includes(user.role)).map((m) => ({
    label: m.label,
    phase: m.phase,
  }));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-slate-200 bg-white px-4 py-4 md:min-h-dvh md:border-b-0 md:border-r md:py-6">
        <div className="mb-4 flex items-center gap-2 px-1 font-semibold md:mb-8">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm text-white">
            PE
          </span>
          <span className="truncate">{APP_NAME}</span>
        </div>
        <Nav items={items} upcoming={upcoming} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{school?.name ?? "Plataforma"}</p>
            <p className="truncate text-xs text-slate-500">
              {user.name} · {ROLE_LABELS[user.role]}
            </p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="btn-secondary px-3 py-1.5">
              Cerrar sesión
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
