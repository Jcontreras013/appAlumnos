import { formatDay, formatLempiras, PAYMENT_METHOD_LABELS, type StudentAccountDto } from "@escolar/shared";
import Link from "next/link";
import { PayOnlineForm } from "./forms";

/**
 * Estado de cuenta de un alumno para quien paga (la familia, o el alumno que responde por sí mismo):
 * lo que debe, pagar con tarjeta si el centro la recibe, y sus recibos.
 */
export function AccountCard({ account: a, email }: { account: StudentAccountDto; email: string }) {
  const pending = a.charges.filter((c) => c.status === "pendiente");
  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-900">
          {a.studentName} <span className="font-normal text-slate-500">· {a.sectionLabel ?? ""}</span>
        </h2>
        <p className={`text-sm font-semibold ${a.overdueCents > 0 ? "text-amber-700" : "text-slate-700"}`}>
          {a.pendingCents > 0 ? `Debe ${formatLempiras(a.pendingCents)}` : "Al día ✓"}
        </p>
      </div>
      {pending.length > 0 &&
        (a.onlinePayments ? (
          <PayOnlineForm studentId={a.studentId} charges={pending} email={email} />
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
}
