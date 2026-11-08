import { formatNationalId, formatPhone } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { academic, type StudentFilters } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Alumnos" };

const PAGE_SIZE = 50;
const ESTADOS = [
  { value: "todos", label: "Todos" },
  { value: "matriculados", label: "Matriculados" },
  { value: "sin_matricula", label: "Sin matrícula este año" },
  { value: "retirados", label: "Retirados" },
] as const;

export default async function StudentsPage({ searchParams }: PageProps<"/panel/alumnos">) {
  const session = await requireRole("admin", "secretaria", "coordinador");
  const canEdit = session.user.role !== "coordinador";
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const page = Math.max(1, Number(one(params.pagina)) || 1);
  const estado = ESTADOS.some((e) => e.value === one(params.estado))
    ? (one(params.estado) as StudentFilters["estado"])
    : "todos";
  const filters: StudentFilters = {
    q: one(params.q) || undefined,
    sectionId: one(params.seccion) || undefined,
    estado,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const [{ items, total }, sections] = await Promise.all([
    academic.listStudents(session.accessToken, filters),
    academic.listSections(session.accessToken),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const imported = one(params.importados);
  const pageHref = (n: number) => {
    const next = new URLSearchParams({ ...(filters.q ? { q: filters.q } : {}), estado: estado ?? "todos" });
    if (filters.sectionId) next.set("seccion", filters.sectionId);
    next.set("pagina", String(n));
    return `/panel/alumnos?${next}` as `/panel/alumnos?${string}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Alumnos</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} {total === 1 ? "alumno" : "alumnos"}
            {filters.q || filters.sectionId || estado !== "todos"
              ? " con los filtros actuales"
              : " registrados"}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Link href="/panel/alumnos/importar" className="btn-secondary">
              Importar desde Excel
            </Link>
            <Link href="/panel/alumnos/nuevo" className="btn-primary">
              Nuevo alumno
            </Link>
          </div>
        )}
      </div>

      {imported && (
        <div
          role="status"
          className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900"
        >
          Se importaron y matricularon {imported} alumnos.
        </div>
      )}

      <search>
        <form className="card grid gap-3 p-4 sm:grid-cols-[1fr_14rem_12rem_auto]">
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Buscar por nombre o identidad"
            aria-label="Buscar"
            className="input"
          />
          <select
            name="seccion"
            defaultValue={filters.sectionId ?? ""}
            aria-label="Sección"
            className="input"
          >
            <option value="">Todas las secciones</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select name="estado" defaultValue={estado} aria-label="Estado" className="input">
            {ESTADOS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary">
            Filtrar
          </button>
        </form>
      </search>

      <section className="card overflow-hidden">
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {total === 0 && !filters.q && !filters.sectionId && estado === "todos"
              ? "Todavía no hay alumnos. Agrégalos uno por uno o impórtalos desde Excel."
              : "Ningún alumno coincide con la búsqueda."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Alumno</th>
                  <th className="px-4 py-3 font-semibold">Sección</th>
                  <th className="px-4 py-3 font-semibold">Responsable principal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/panel/alumnos/${s.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {s.lastNames}, {s.firstNames}
                      </Link>
                      <p className="text-xs tabular-nums text-slate-500">{formatNationalId(s.nationalId)}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {s.enrollment ? (
                        s.enrollment.status === "activa" ? (
                          s.enrollment.sectionLabel
                        ) : (
                          <span className="text-slate-400">Retirado ({s.enrollment.sectionLabel})</span>
                        )
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Sin matrícula
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.primaryGuardian ? (
                        <>
                          <p>{s.primaryGuardian.fullName}</p>
                          <p className="text-xs tabular-nums text-slate-500">
                            {formatPhone(s.primaryGuardian.phone)}
                          </p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pages > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-secondary">
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="btn-secondary">
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
