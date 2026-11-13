import type { Metadata } from "next";
import { ClearOfflinePages } from "@/components/offline";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { expirada } = await searchParams;

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* En un dispositivo compartido, las páginas guardadas del maestro anterior no quedan a la vista. */}
      <ClearOfflinePages />
      <section className="hidden flex-col justify-between bg-brand-900 p-12 text-white lg:flex">
        <Logo />
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-semibold leading-tight">Cada centro educativo, al día.</h1>
          <p className="text-brand-100">
            Asistencia, notas, planificación y alerta temprana desde el aula, aun sin internet. La dirección,
            la departamental y las familias ven lo que les toca, el mismo día.
          </p>
        </div>
        <p className="text-sm text-brand-100/70">Hecho en Honduras.</p>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo dark />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Iniciar sesión</h2>
          <p className="mb-6 mt-1 text-sm text-slate-500">{APP_TAGLINE}</p>
          <LoginForm expired={expirada === "1"} />
        </div>
      </section>
    </main>
  );
}

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex items-center gap-2 font-semibold ${dark ? "text-slate-900" : "text-white"}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-brand-500 text-sm text-white">PE</span>
      {APP_NAME}
    </div>
  );
}
