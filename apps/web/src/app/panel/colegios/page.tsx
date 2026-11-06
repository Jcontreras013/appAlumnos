import { formatDate, formatRtn } from "@escolar/shared";
import type { Metadata } from "next";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { setSchoolActiveAction } from "./actions";
import { CreateSchoolForm } from "./create-school-form";

export const metadata: Metadata = { title: "Colegios" };

export default async function SchoolsPage() {
  const session = await requireRole("superadmin");
  const schools = await identity.listSchools(session.accessToken);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Colegios</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cada colegio es un espacio aislado: sus datos nunca se mezclan con los de otro.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="card overflow-hidden">
          {schools.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">
              Todavía no hay colegios. Crea el primero.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Colegio</th>
                    <th className="px-4 py-3 font-semibold">RTN</th>
                    <th className="px-4 py-3 font-semibold">Alta</th>
                    <th className="px-4 py-3 font-semibold">Estado</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schools.map((s) => (
                    <tr key={s.id} className={s.active ? "" : "bg-slate-50 text-slate-400"}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{s.name}</p>
                        <p className="font-mono text-xs text-slate-500">{s.slug}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatRtn(s.rtn)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDate(s.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            s.active ? "bg-brand-50 text-brand-700" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {s.active ? "Activo" : "Desactivado"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <form action={setSchoolActiveAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="active" value={String(!s.active)} />
                          <button
                            type="submit"
                            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                          >
                            {s.active ? "Desactivar" : "Reactivar"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card h-fit p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Nuevo colegio</h2>
          <CreateSchoolForm />
        </section>
      </div>
    </div>
  );
}
