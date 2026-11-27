import { formatDay, formatLempiras, PAYMENT_METHOD_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Fold, FoldTag } from "@/components/fold";
import { Kpi } from "@/components/kpi";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { cancelFeeAction } from "./actions";
import { FeeForm } from "./forms";

export const metadata: Metadata = { title: "Pagos" };

/** Cobros del centro, quién debe (por sección) y los últimos pagos. Secretaría y dirección. */
export default async function PaymentsPage() {
  const session = await requireRole("admin", "secretaria");
  const token = session.accessToken;
  const director = session.user.role === "admin";
  const [balances, fees, recent, grades, sections] = await Promise.all([
    academic.balances(token),
    academic.fees(token),
    academic.recentPayments(token),
    academic.listGrades(token),
    academic.listSections(token),
  ]);
  const pending = balances.reduce((sum, b) => sum + b.pendingCents, 0);
  const overdue = balances.reduce((sum, b) => sum + b.overdueCents, 0);
  const collected = recent
    .filter((p) => p.status === "confirmado")
    .reduce((sum, p) => sum + p.amountCents, 0);
  // Quién debe, una sección por desplegable (en el orden del centro).
  const bySection = new Map<string, typeof balances>(sections.map((s) => [s.label, []]));
  for (const b of balances) {
    const key = b.sectionLabel ?? "Sin matrícula este año";
    bySection.set(key, [...(bySection.get(key) ?? []), b]);
  }
  const groups = [...bySection.entries()].filter(([, list]) => list.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pagos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cobros a las familias, quién debe y los pagos recibidos (en la oficina o con tarjeta).
          </p>
        </div>
        {director && (
          <Link href="/panel/pagos/configuracion" className="btn-secondary">
            Pago con tarjeta (PixelPay)
          </Link>
        )}
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi
          label="Por cobrar"
          value={formatLempiras(pending)}
          hint={`${balances.length} alumnos con saldo`}
        />
        <Kpi
          label="Vencido"
          value={formatLempiras(overdue)}
          tone={overdue > 0 ? "alert" : "ok"}
          hint="ya pasó la fecha"
        />
        <Kpi label="Recibido" value={formatLempiras(collected)} hint="en los últimos 100 pagos" />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          <h2 className="font-semibold text-slate-900">Quién debe</h2>
          {groups.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">Nadie tiene cobros pendientes.</p>
          ) : (
            groups.map(([label, list]) => {
              const late = list.filter((b) => b.overdueCents > 0).length;
              return (
                <Fold
                  key={label}
                  title={label}
                  summary={
                    <>
                      <FoldTag>{formatLempiras(list.reduce((s, b) => s + b.pendingCents, 0))}</FoldTag>
                      {late > 0 && <FoldTag tone="alert">{late} con saldo vencido</FoldTag>}
                    </>
                  }
                >
                  <ul className="divide-y divide-slate-100">
                    {list.map((b) => (
                      <li key={b.studentId}>
                        <Link
                          href={`/panel/pagos/alumno/${b.studentId}`}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"
                        >
                          <span className="font-medium text-slate-900">{b.studentName}</span>
                          <span className="text-right tabular-nums">
                            {formatLempiras(b.pendingCents)}
                            {b.overdueCents > 0 && (
                              <span className="block text-xs text-amber-700">
                                vencido {formatLempiras(b.overdueCents)}
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Fold>
              );
            })
          )}

          <h2 className="pt-4 font-semibold text-slate-900">Cobros</h2>
          <Fold title="Cobros creados" summary={<FoldTag>{fees.length}</FoldTag>}>
            {fees.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Todavía no hay cobros.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {fees.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span
                        className={`block font-medium ${f.cancelled ? "text-slate-400 line-through" : "text-slate-900"}`}
                      >
                        {f.name} · {formatLempiras(f.amountCents)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {f.scopeLabel} · vence {formatDay(f.dueOn)} · {f.paid} de {f.charges} pagados
                      </span>
                    </span>
                    {director && !f.cancelled && f.pendingCents > 0 && (
                      <form action={cancelFeeAction}>
                        <input type="hidden" name="id" value={f.id} />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-slate-500 hover:text-red-700"
                        >
                          Anular lo pendiente
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Fold>

          <Fold title="Últimos pagos" summary={<FoldTag>{recent.length}</FoldTag>}>
            {recent.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Todavía no hay pagos.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/panel/pagos/recibo/${p.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900">
                          Recibo {p.receiptNumber} · {p.studentName}
                        </span>
                        <span className="text-xs text-slate-500">
                          {PAYMENT_METHOD_LABELS[p.method]} · {p.byName}
                          {p.status === "anulado" && " · ANULADO"}
                        </span>
                        {p.reference?.startsWith("PAGO DOBLE") && p.status !== "anulado" && (
                          <span className="mt-0.5 block text-xs font-semibold text-amber-700">
                            Pago doble: revisar la devolución
                          </span>
                        )}
                      </span>
                      <span
                        className={`tabular-nums ${p.status === "anulado" ? "text-slate-400 line-through" : ""}`}
                      >
                        {formatLempiras(p.amountCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Fold>
        </div>

        <aside className="card h-fit p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Nuevo cobro</h2>
          <FeeForm
            grades={grades.map((g) => ({ value: g.id, label: g.name }))}
            sections={sections.map((s) => ({ value: s.id, label: s.label }))}
          />
        </aside>
      </div>
    </div>
  );
}
