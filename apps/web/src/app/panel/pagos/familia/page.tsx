import { formatDay, formatLempiras, PAYMENT_METHOD_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { PayOnlineForm } from "../forms";

export const metadata: Metadata = { title: "Pagos" };

/** La familia: lo que debe cada hijo, pagar con tarjeta y sus recibos. */
export default async function FamilyPaymentsPage({ searchParams }: PageProps<"/panel/pagos/familia">) {
  const session = await requireRole("padre");
  const { cancelado } = await searchParams;
  const children = await academic.familyChildren(session.accessToken);
  const accounts = await Promise.all(
    children.map((c) => academic.childAccount(session.accessToken, c.studentId)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Pagos</h1>
        <p className="mt-1 text-sm text-slate-500">Lo que debe cada uno de tus hijos y sus recibos.</p>
      </div>
      {cancelado && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          No se hizo el cobro: cancelaste el pago. Puedes intentarlo de nuevo cuando quieras.
        </p>
      )}
      {accounts.length === 0 && (
        <p className="card p-6 text-center text-sm text-slate-500">No hay alumnos ligados a tu cuenta.</p>
      )}
      {accounts.map((a) => {
        const pending = a.charges.filter((c) => c.status === "pendiente");
        return (
          <section key={a.studentId} className="card space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">
                {a.studentName} <span className="font-normal text-slate-500">· {a.sectionLabel ?? ""}</span>
              </h2>
              <p
                className={`text-sm font-semibold ${a.overdueCents > 0 ? "text-amber-700" : "text-slate-700"}`}
              >
                {a.pendingCents > 0 ? `Debe ${formatLempiras(a.pendingCents)}` : "Al día ✓"}
              </p>
            </div>
            {pending.length > 0 &&
              (a.onlinePayments ? (
                <PayOnlineForm studentId={a.studentId} charges={pending} email={session.user.email ?? ""} />
              ) : (
                <ul className="space-y-1 text-sm">
                  {pending.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span>
                        {c.name} <span className="text-xs text-slate-500">· vence {formatDay(c.dueOn)}</span>
                      </span>
                      <span className="tabular-nums">{formatLempiras(c.amountCents)}</span>
                    </li>
                  ))}
                  <li className="pt-2 text-xs text-slate-500">Paga en la secretaría del centro.</li>
                </ul>
              ))}
            {a.payments.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recibos</h3>
                <ul className="space-y-1 text-sm">
                  {a.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <Link href={`/panel/pagos/recibo/${p.id}`} className="text-brand-700 hover:underline">
                        Recibo {p.receiptNumber} · {PAYMENT_METHOD_LABELS[p.method]}
                        {p.status === "anulado" && " (anulado)"}
                      </Link>
                      <span className="tabular-nums">{formatLempiras(p.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
