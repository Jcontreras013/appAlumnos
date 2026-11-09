import type { Metadata } from "next";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { DepartmentForm, DistrictForm, RegionalUserForm } from "./forms";

export const metadata: Metadata = { title: "Departamentos" };

export default async function DepartmentsPage() {
  const { accessToken } = await requireRole("superadmin");
  const [departments, schools] = await Promise.all([
    identity.listDepartments(accessToken),
    identity.scopeSchools(accessToken),
  ]);
  const scopes = departments.flatMap((d) => [
    { value: `dep:${d.id}`, label: `Departamental de ${d.name}` },
    ...d.districts.map((x) => ({ value: `dis:${x.id}`, label: `Distrito ${x.name} (${d.name})` })),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Departamentos y distritos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Estructura de la Secretaría de Educación: cada centro pertenece a un distrito y cada distrito a un
          departamento. Las direcciones departamentales y distritales ven todos los centros de su ámbito.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-4">
          {departments.length === 0 && (
            <p className="card p-6 text-center text-sm text-slate-500">Todavía no hay departamentos.</p>
          )}
          {departments.map((d) => (
            <article key={d.id} className="card p-5">
              <h2 className="font-semibold text-slate-900">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                  {d.code}
                </span>
                {d.name}
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {d.districts.map((x) => {
                  const count = schools.filter((s) => s.districtId === x.id).length;
                  return (
                    <li key={x.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">Distrito {x.name}</span>
                      <span className="block text-xs text-slate-500">
                        {count} {count === 1 ? "centro" : "centros"}
                      </span>
                    </li>
                  );
                })}
                {d.districts.length === 0 && (
                  <li className="text-sm text-slate-500">Sin distritos todavía.</li>
                )}
              </ul>
            </article>
          ))}
        </section>

        <aside className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-4 font-semibold text-slate-900">Nuevo departamento</h2>
            <DepartmentForm />
          </div>
          {departments.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-4 font-semibold text-slate-900">Nuevo distrito</h2>
              <DistrictForm departments={departments.map((d) => ({ value: d.id, label: d.name }))} />
            </div>
          )}
          {scopes.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-4 font-semibold text-slate-900">Acceso para una dirección</h2>
              <RegionalUserForm scopes={scopes} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
