import {
  addDays,
  currentWeek,
  formatDay,
  formatWeekRange,
  isIsoDate,
  mondayOf,
  PLAN_STATUS_LABELS,
  type PlanBoardDto,
  type PlanStatus,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Kpi } from "@/components/kpi";
import { PlanStatusBadge } from "@/components/plan-status";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { createPlanAction } from "./actions";

export const metadata: Metadata = { title: "Planificación semanal" };

type Filter = PlanStatus | "sin_iniciar" | "atrasadas" | "";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "", label: "Todas" },
  { value: "enviada", label: "Por revisar" },
  { value: "atrasadas", label: "Atrasadas" },
  { value: "devuelta", label: "Devueltas" },
  { value: "aprobada", label: "Aprobadas" },
  { value: "sin_iniciar", label: "Sin iniciar" },
];

export default async function PlanningPage({ searchParams }: PageProps<"/panel/planificacion">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria");
  const token = session.accessToken;
  const role = session.user.role;
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const raw = one(query.semana);
  const week = isIsoDate(raw) ? mondayOf(raw) : currentWeek();
  const filter = one(query.estado) as Filter;
  const isOffice = role === "admin" || role === "coordinador" || role === "secretaria";

  const [mine, board] = await Promise.all([
    role === "secretaria" ? null : academic.myPlans(token, week).catch(() => null),
    isOffice ? academic.planBoard(token, week).catch(() => null) : null,
  ]);
  const href = (semana: string, estado: Filter = filter) =>
    `/panel/planificacion?semana=${semana}${estado ? `&estado=${estado}` : ""}` as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Planificación semanal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Semana del {formatWeekRange(week)}
            {(mine ?? board) && <> · se entrega a más tardar el {formatDay((mine ?? board)?.deadline)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href(addDays(week, -7))}
            className="btn-secondary px-3 py-1.5"
            aria-label="Semana anterior"
          >
            ←
          </Link>
          {week !== currentWeek() && (
            <Link href={href(currentWeek())} className="btn-secondary px-3 py-1.5">
              Esta semana
            </Link>
          )}
          <Link
            href={href(addDays(week, 7))}
            className="btn-secondary px-3 py-1.5"
            aria-label="Semana siguiente"
          >
            →
          </Link>
          {(role === "admin" || role === "coordinador") && (
            <Link href="/panel/planificacion/plantilla" className="btn-secondary px-3 py-1.5">
              Plantilla
            </Link>
          )}
        </div>
      </div>

      {mine && (mine.rows.length > 0 || role === "docente") && <MyWeek board={mine} me={session.user.id} />}
      {board && <SchoolBoard board={board} filter={filter} href={href} />}
    </div>
  );
}

function MyWeek({ board, me }: { board: PlanBoardDto; me: string }) {
  const pending = board.rows.filter((r) => !r.submittedAt).length;
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Mis clases</h2>
        {board.rows.length > 0 && (
          <p className="text-xs text-slate-500">
            {pending === 0 ? "Todas entregadas" : `${pending} por entregar`}
          </p>
        )}
      </div>
      {board.rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">No tienes clases asignadas esta semana.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {board.rows.map((r) => (
            <li key={r.assignment.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {r.assignment.subjectName} · {r.assignment.sectionLabel}
                </p>
                {r.assignment.teacherUserId !== me && (
                  <p className="text-xs text-amber-800">Cubres a {r.assignment.teacherName}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <PlanStatusBadge status={r.status} overdue={r.overdue} />
                {r.planId ? (
                  <Link href={`/panel/planificacion/${r.planId}`} className="btn-secondary px-3 py-1.5">
                    {r.status === "borrador" || r.status === "devuelta" ? "Continuar" : "Ver"}
                  </Link>
                ) : (
                  <form action={createPlanAction}>
                    <input type="hidden" name="assignmentId" value={r.assignment.id} />
                    <input type="hidden" name="weekStart" value={board.weekStart} />
                    <button type="submit" className="btn-primary px-3 py-1.5">
                      Planificar
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SchoolBoard({
  board,
  filter,
  href,
}: {
  board: PlanBoardDto;
  filter: Filter;
  href: (semana: string, estado?: Filter) => `/panel/planificacion?semana=${string}`;
}) {
  const t = board.totals;
  const delivered = board.rows.filter((r) => r.submittedAt).length;
  const rows = board.rows
    .filter((r) => !filter || (filter === "atrasadas" ? r.overdue : r.status === filter))
    .sort((a, b) => order(a.status) - order(b.status) || Number(b.overdue) - Number(a.overdue));

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Entregadas"
          value={`${delivered} / ${board.rows.length}`}
          hint="clases con planificación enviada"
          tone={board.rows.length > 0 && delivered === board.rows.length ? "ok" : "neutral"}
        />
        <Kpi
          label="Por revisar"
          value={t.enviada}
          hint="esperan tu revisión"
          tone={t.enviada > 0 ? "alert" : "ok"}
        />
        <Kpi label="Aprobadas" value={t.aprobada} tone="neutral" />
        <Kpi
          label="Atrasadas"
          value={t.atrasadas}
          hint={`vencieron el ${formatDay(board.deadline)}`}
          tone={t.atrasadas > 0 ? "alert" : "ok"}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <h2 className="mr-2 text-sm font-semibold text-slate-700">Tablero del centro</h2>
          {FILTERS.map((f) => (
            <Link
              key={f.value || "todas"}
              href={href(board.weekStart, f.value)}
              aria-current={filter === f.value ? "page" : undefined}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                filter === f.value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-white"
              }`}
            >
              {f.label}
              {f.value && ` (${f.value === "atrasadas" ? t.atrasadas : t[f.value]})`}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">
            {board.rows.length === 0 ? "No hay clases asignadas este año." : "Ninguna en este estado."}
          </p>
        ) : (
          <Table head={["Sección", "Materia", "Docente", "Estado", ""]}>
            {rows.map((r) => (
              <tr key={r.assignment.id}>
                <td className="whitespace-nowrap px-4 py-3">{r.assignment.sectionLabel}</td>
                <td className="px-4 py-3">{r.assignment.subjectName}</td>
                <td className="px-4 py-3">{r.assignment.teacherName}</td>
                <td className="px-4 py-3">
                  <PlanStatusBadge status={r.status} overdue={r.overdue} />
                </td>
                <td className="px-4 py-3 text-right">
                  {r.planId && (
                    <Link
                      href={`/panel/planificacion/${r.planId}`}
                      className={
                        r.status === "enviada"
                          ? "btn-primary px-3 py-1.5"
                          : "text-xs font-semibold text-brand-700 hover:underline"
                      }
                    >
                      {r.status === "enviada" ? "Revisar" : "Ver"}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Estados: {Object.values(PLAN_STATUS_LABELS).join(" · ")}. Atrasada = no se ha enviado y ya pasó la
        fecha límite.
      </p>
    </section>
  );
}

const order = (s: PlanStatus | "sin_iniciar") =>
  ({ enviada: 0, devuelta: 1, sin_iniciar: 2, borrador: 3, aprobada: 4 })[s];

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h || "acciones"} className="px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
