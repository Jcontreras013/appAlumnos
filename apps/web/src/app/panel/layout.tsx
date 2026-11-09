import { isRegionalRole, ROLE_LABELS, type Role } from "@escolar/shared";
import type { ReactNode } from "react";
import { Nav, type NavItem } from "@/components/nav";
import { SchoolLogo } from "@/components/school-logo";
import { APP_NAME } from "@/lib/brand";
import { getSession } from "@/lib/dal";
import { MODULES } from "@/lib/modules";
import { logoutAction, switchMembershipAction } from "./actions";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { user, school, current, memberships } = await getSession();

  const is = (...roles: Role[]) => roles.includes(user.role);
  const items: NavItem[] = [];
  if (isRegionalRole(user.role)) {
    items.push({ href: "/panel/region", label: "Tablero de centros" });
  } else {
    items.push({ href: "/panel", label: "Inicio" });
  }
  if (is("superadmin")) {
    items.push({ href: "/panel/colegios", label: "Centros educativos" });
    items.push({ href: "/panel/departamentos", label: "Departamentos" });
  }
  if (is("admin", "secretaria", "coordinador")) items.push({ href: "/panel/alumnos", label: "Alumnos" });
  if (is("admin", "coordinador", "secretaria")) {
    items.push({ href: "/panel/licencias", label: "Licencias y sustitutos" });
    items.push({ href: "/panel/estructura", label: "Estructura académica" });
  }
  if (is("admin")) {
    items.push({ href: "/panel/usuarios", label: "Personal y usuarios" });
    items.push({ href: "/panel/colegio", label: "Mi colegio" });
  }
  const upcoming = MODULES.filter((m) => !m.href && m.roles.includes(user.role)).map((m) => ({
    label: m.label,
    phase: m.phase,
  }));
  const others = memberships.filter((m) => m.id !== current.id);

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
          <div className="flex min-w-0 items-center gap-3">
            {school ? (
              <SchoolLogo school={school} className="size-10" />
            ) : (
              <span
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700"
                aria-hidden="true"
              >
                {current.scopeType === "departamento" ? "DD" : current.scopeType === "distrito" ? "DT" : "PE"}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {school?.name ?? current.scopeName}
              </p>
              <p className="truncate text-xs text-slate-500">
                {user.name} · {ROLE_LABELS[user.role]}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {others.length > 0 && (
              // Una maestra en dos escuelas cambia de centro aquí, sin volver a iniciar sesión.
              <details className="relative">
                <summary className="btn-secondary cursor-pointer list-none px-3 py-1.5">
                  Cambiar de centro
                </summary>
                <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  {others.map((m) => (
                    <form key={m.id} action={switchMembershipAction}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <button
                        type="submit"
                        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="block font-medium text-slate-900">{m.scopeName}</span>
                        <span className="block text-xs text-slate-500">{ROLE_LABELS[m.role]}</span>
                      </button>
                    </form>
                  ))}
                </div>
              </details>
            )}
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary px-3 py-1.5">
                Cerrar sesión
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
