import { formatDate, ROLE_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { setUserActiveAction } from "./actions";
import { CreateUserForm } from "./create-user-form";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const session = await requireRole("admin");
  const users = await identity.listUsers(session.accessToken);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Personal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Personal de {session.school?.name}. Las familias se manejan desde la ficha de cada alumno.
          </p>
        </div>
        <Link href="/panel/usuarios/importar" className="btn-secondary">
          Cargar personal desde Excel
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nombre</th>
                  <th className="px-4 py-3 font-semibold">Rol</th>
                  <th className="px-4 py-3 font-semibold">Alta</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? "" : "bg-slate-50 text-slate-400"}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{ROLE_LABELS[u.role]}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.active ? "bg-brand-50 text-brand-700" : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {u.active ? "Activo" : "Desactivado"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== session.user.id && (
                        <form action={setUserActiveAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="active" value={String(!u.active)} />
                          <button
                            type="submit"
                            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                          >
                            {u.active ? "Desactivar" : "Reactivar"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card h-fit p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Nuevo usuario</h2>
          <CreateUserForm />
        </section>
      </div>
    </div>
  );
}
