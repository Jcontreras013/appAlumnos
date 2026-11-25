import { isRegionalRole, MESSAGING_ROLES, ROLE_LABELS, type Role } from "@escolar/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChangePasswordForm } from "@/components/change-password-form";
import { LogoutButton } from "@/components/logout-button";
import { MfaSetup } from "@/components/mfa-setup";
import { NativeAppBridge } from "@/components/native-app-bridge";
import { Nav, type NavItem } from "@/components/nav";
import { OfflineAgent } from "@/components/offline";
import { SchoolLogo } from "@/components/school-logo";
import { APP_MARK, APP_NAME } from "@/lib/brand";
import { getSession } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { currentLicense } from "@/lib/license";
import { MODULES } from "@/lib/modules";
import { logoutAction, switchMembershipAction } from "./actions";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const [{ user, school, current, memberships, mfa, accessToken }, license] = await Promise.all([
    getSession(),
    currentLicense(),
  ]);
  // Una copia vendida sin licencia válida no muestra el panel.
  const unlicensed = license.state === "invalida";
  // Antes de usar el panel: cambiar la contraseña temporal y, en los cargos que lo exigen, activar
  // la verificación en dos pasos.
  const gated = unlicensed || user.mustChangePassword || mfa.setupRequired;

  const is = (...roles: Role[]) => roles.includes(user.role);
  const messaging = !gated && is(...MESSAGING_ROLES);
  // Si el servicio no responde, el menú sale igual (sin contador).
  const unreadMessages = messaging
    ? ((await identity.unreadMessages(accessToken).catch(() => null))?.conversations ?? 0)
    : 0;
  const items: NavItem[] = [];
  if (isRegionalRole(user.role)) {
    items.push({ href: "/panel/region", label: "Tablero de centros" });
    items.push({ href: "/panel/region/indicadores", label: "Indicadores del piloto" });
  } else if (is("padre")) {
    items.push({ href: "/panel/familia", label: "Mis hijos" });
    items.push({ href: "/panel/aula", label: "Clases" });
    items.push({ href: "/panel/biblioteca", label: "Biblioteca" });
  } else if (is("estudiante")) {
    items.push({ href: "/panel/aula", label: "Mis clases" });
    items.push({ href: "/panel/mis-notas", label: "Mis notas" });
    items.push({ href: "/panel/biblioteca", label: "Biblioteca" });
  } else {
    items.push({ href: "/panel", label: "Inicio" });
  }
  if (messaging) items.push({ href: "/panel/mensajes", label: "Mensajes", unreadBadge: true });
  if (is("superadmin")) {
    items.push({ href: "/panel/colegios", label: "Centros educativos" });
    items.push({ href: "/panel/departamentos", label: "Departamentos" });
  }
  // En escuelas pequeñas la directora también da clases: también tiene su cuaderno.
  if (is("docente", "admin", "coordinador")) items.push({ href: "/panel/cuaderno", label: "Mi cuaderno" });
  if (is("docente", "admin", "coordinador", "secretaria")) {
    items.push({ href: "/panel/aula", label: "Aula virtual" });
  }
  if (is("docente", "admin", "coordinador", "secretaria")) {
    items.push({ href: "/panel/planificacion", label: "Planificación" });
  }
  if (is("admin", "coordinador", "secretaria")) {
    items.push({ href: "/panel/seguimiento", label: "Seguimiento" });
  }
  if (is("admin", "coordinador", "secretaria", "docente")) {
    items.push({ href: "/panel/conducta", label: "Conducta" });
  }
  if (is("admin", "secretaria", "coordinador")) items.push({ href: "/panel/alumnos", label: "Alumnos" });
  if (is("admin", "secretaria")) items.push({ href: "/panel/traslados", label: "Traslados" });
  if (is("admin", "coordinador", "secretaria")) {
    items.push({ href: "/panel/licencias", label: "Licencias y sustitutos" });
    items.push({ href: "/panel/estructura", label: "Estructura académica" });
  }
  if (is("admin", "coordinador", "secretaria", "docente")) {
    items.push({ href: "/panel/horario", label: "Horario" });
    items.push({ href: "/panel/calendario", label: "Calendario escolar" });
    items.push({ href: "/panel/avisos", label: "Avisos" });
    items.push({ href: "/panel/documentos", label: "Documentos" });
    items.push({ href: "/panel/biblioteca", label: "Biblioteca" });
  }
  if (is("admin", "coordinador", "secretaria")) {
    items.push({ href: "/panel/exportar", label: "Exportar datos" });
  }
  if (is("admin")) {
    items.push({ href: "/panel/usuarios", label: "Personal y usuarios" });
    items.push({ href: "/panel/cierre", label: "Cierre del año" });
    items.push({ href: "/panel/bitacora", label: "Bitácora" });
    items.push({ href: "/panel/colegio", label: "Mi centro" });
  }
  items.push({ href: "/panel/ayuda", label: "Ayuda" });
  const upcoming = MODULES.filter((m) => !m.href && m.roles.includes(user.role)).map((m) => ({
    label: m.label,
    phase: m.phase,
  }));
  const others = memberships.filter((m) => m.id !== current.id);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr] print:block">
      <OfflineAgent owner={current.id} />
      <NativeAppBridge messaging={messaging} />
      <aside className="border-b border-slate-200 bg-white px-4 py-4 md:min-h-dvh md:border-b-0 md:border-r md:py-6 print:hidden">
        <div className="mb-4 flex items-center gap-2 px-1 font-semibold md:mb-8">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm text-white">
            {APP_MARK}
          </span>
          <span className="truncate">{APP_NAME}</span>
        </div>
        <Nav items={gated ? [] : items} upcoming={gated ? [] : upcoming} unreadMessages={unreadMessages} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-8 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            {school ? (
              <SchoolLogo school={school} className="size-10" />
            ) : (
              <span
                className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700"
                aria-hidden="true"
              >
                {current.scopeType === "departamento"
                  ? "DD"
                  : current.scopeType === "distrito"
                    ? "DT"
                    : APP_MARK}
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
            <Link
              href="/panel/cuenta"
              className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:block"
            >
              Mi cuenta
            </Link>
            <LogoutButton action={logoutAction} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 print:max-w-none print:p-0">
          {unlicensed ? (
            <div className="max-w-2xl space-y-4" role="alert">
              <h1 className="text-2xl font-semibold text-slate-900">
                Esta instalación no tiene una licencia válida
              </h1>
              <p className="text-sm text-slate-600">
                {APP_NAME} no puede usarse hasta que la licencia esté al día. Los datos del centro están
                guardados y no se pierde nada.
              </p>
              <div className="card space-y-2 p-5 text-sm">
                <p className="font-medium text-slate-900">Motivo</p>
                <p className="text-slate-600">{license.reason}</p>
                <p className="pt-2 text-slate-500">
                  Si compraste la licencia, revisa que la clave esté bien escrita en la configuración del
                  servidor o escribe a quien te vendió {APP_NAME}.
                </p>
              </div>
            </div>
          ) : user.mustChangePassword ? (
            // Entró con la contraseña temporal que le dio el centro: primero la cambia.
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  Bienvenido, {user.name.split(" ")[0]}
                </h1>
                <p className="mt-1 max-w-xl text-sm text-slate-500">
                  Entraste con una contraseña temporal. Para proteger tu cuenta, elige ahora una contraseña
                  que solo tú conozcas.
                </p>
              </div>
              <div className="card p-5">
                <ChangePasswordForm temporary />
              </div>
            </div>
          ) : mfa.setupRequired ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Activa la verificación en dos pasos</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-500">
                  Tu cuenta ve los datos de muchos centros. Para protegerla, además de la contraseña te
                  pediremos un código de tu teléfono al entrar. Toma un par de minutos y se hace una sola vez.
                </p>
              </div>
              <div className="card p-5">
                <MfaSetup />
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
