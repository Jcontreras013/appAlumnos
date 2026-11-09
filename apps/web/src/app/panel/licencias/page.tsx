import { formatDay, LEAVE_TYPE_LABELS, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Kpi } from "@/components/kpi";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { cancelLeaveAction, cancelSubstitutionAction } from "./actions";
import { CoverAllForm, LeaveForm, SubstituteForm } from "./forms";

export const metadata: Metadata = { title: "Licencias y sustitutos" };

const TABS = [
  { value: "actuales", label: "Vigentes y próximas" },
  { value: "pasadas", label: "Pasadas" },
  { value: "canceladas", label: "Canceladas" },
] as const;

export default async function LeavesPage({ searchParams }: PageProps<"/panel/licencias">) {
  const session = await requireRole("admin", "coordinador", "secretaria");
  const canEdit = session.user.role !== "secretaria";
  const params = await searchParams;
  const estadoParam = Array.isArray(params.estado) ? params.estado[0] : params.estado;
  const estado = TABS.find((t) => t.value === estadoParam)?.value ?? "actuales";
  const today = todayInHonduras();

  const [coverage, leaves, staff] = await Promise.all([
    academic.coverage(session.accessToken),
    academic.listLeaves(session.accessToken, estado),
    identity.listUsers(session.accessToken),
  ]);
  const teachers = staff
    .filter((u) => u.active && (u.role === "docente" || u.role === "coordinador"))
    .filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i)
    .map((u) => ({ value: u.id, label: u.name }));
  const uncovered = coverage.rows.filter((r) => r.status === "sin_cubrir");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Licencias y sustitutos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cuando un maestro se ausenta (vacaciones, enfermedad, capacitación…), registra la licencia y asigna
          quién cubre cada una de sus clases. Al terminar la licencia, las clases vuelven solas a su maestro.
        </p>
      </div>

      <section className="grid grid-cols-3 gap-3">
        <Kpi label="Con su maestro hoy" value={coverage.totals.normal} />
        <Kpi label="Cubiertas por sustituto" value={coverage.totals.cubierta} />
        <Kpi
          label="Sin maestro hoy"
          value={coverage.totals.sin_cubrir}
          tone={coverage.totals.sin_cubrir > 0 ? "alert" : "ok"}
        />
      </section>

      {uncovered.length > 0 && (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Clases sin maestro hoy</p>
          <ul className="mt-2 space-y-1">
            {uncovered.map((r) => (
              <li key={r.assignment.id}>
                {r.assignment.sectionLabel} · {r.assignment.subjectName} — {r.assignment.teacherName} (
                {r.leave ? LEAVE_TYPE_LABELS[r.leave.type].toLowerCase() : "licencia"})
                {r.leave && (
                  <a href={`#licencia-${r.leave.id}`} className="ml-2 font-semibold underline">
                    Asignar sustituto
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={`grid gap-6 ${canEdit ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
        <section className="space-y-4">
          <nav aria-label="Licencias" className="flex gap-1 border-b border-slate-200">
            {TABS.map((t) => (
              <Link
                key={t.value}
                href={`/panel/licencias?estado=${t.value}`}
                aria-current={t.value === estado ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  t.value === estado
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {leaves.length === 0 && (
            <p className="card p-6 text-center text-sm text-slate-500">
              {estado === "actuales" ? "No hay licencias vigentes ni próximas." : "No hay licencias aquí."}
            </p>
          )}

          {leaves.map((leave) => {
            const active = leave.startsOn <= today && leave.endsOn >= today && !leave.cancelled;
            // Sustitutos posibles: nadie que esté de licencia en esas mismas fechas.
            const others = teachers.filter(
              (t) =>
                t.value !== leave.teacherUserId &&
                !leaves.some(
                  (l) =>
                    !l.cancelled &&
                    l.teacherUserId === t.value &&
                    l.startsOn <= leave.endsOn &&
                    l.endsOn >= leave.startsOn,
                ),
            );
            return (
              <article key={leave.id} id={`licencia-${leave.id}`} className="card scroll-mt-6 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">
                      {leave.teacherName}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {LEAVE_TYPE_LABELS[leave.type]}
                      </span>
                      {active && (
                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Ausente hoy
                        </span>
                      )}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Del {formatDay(leave.startsOn)} al {formatDay(leave.endsOn)}
                      {leave.notes ? ` · ${leave.notes}` : ""}
                    </p>
                    <p className="text-xs text-slate-400">Registrada por {leave.createdByName}</p>
                  </div>
                  {canEdit && !leave.cancelled && estado === "actuales" && (
                    <form action={cancelLeaveAction}>
                      <input type="hidden" name="id" value={leave.id} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-slate-500 hover:text-red-700"
                      >
                        Cancelar licencia
                      </button>
                    </form>
                  )}
                </div>

                {canEdit &&
                  !leave.cancelled &&
                  estado === "actuales" &&
                  leave.classes.filter((c) => !c.substitution).length > 1 && (
                    <div className="mt-4">
                      <CoverAllForm
                        leaveId={leave.id}
                        teachers={others}
                        pending={leave.classes.filter((c) => !c.substitution).length}
                      />
                    </div>
                  )}

                {leave.classes.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">No tiene clases asignadas este año.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {leave.classes.map(({ assignment, substitution }) => (
                      <li key={assignment.id} className="space-y-2 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-900">
                            {assignment.sectionLabel} · {assignment.subjectName}
                          </p>
                          {substitution ? (
                            <p className="flex items-center gap-3 text-sm text-slate-700">
                              <span>
                                Cubre <strong>{substitution.substituteName}</strong>
                                {(substitution.startsOn !== leave.startsOn ||
                                  substitution.endsOn !== leave.endsOn) &&
                                  ` (del ${formatDay(substitution.startsOn)} al ${formatDay(substitution.endsOn)})`}
                              </span>
                              {canEdit && estado === "actuales" && (
                                <form action={cancelSubstitutionAction}>
                                  <input type="hidden" name="id" value={substitution.id} />
                                  <button
                                    type="submit"
                                    className="text-xs font-semibold text-slate-500 hover:text-red-700"
                                  >
                                    Quitar
                                  </button>
                                </form>
                              )}
                            </p>
                          ) : (
                            !leave.cancelled && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                                Sin sustituto
                              </span>
                            )
                          )}
                        </div>
                        {canEdit && !substitution && !leave.cancelled && estado === "actuales" && (
                          <SubstituteForm leaveId={leave.id} assignmentId={assignment.id} teachers={others} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </section>

        {canEdit && (
          <aside className="card h-fit p-5">
            <h2 className="mb-4 font-semibold text-slate-900">Registrar licencia</h2>
            {teachers.length === 0 ? (
              <p className="text-sm text-slate-500">
                Primero crea los usuarios de los maestros en Personal y usuarios.
              </p>
            ) : (
              <LeaveForm teachers={teachers} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
