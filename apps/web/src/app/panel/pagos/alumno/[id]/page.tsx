import { formatDay, formatLempiras, PAYMENT_METHOD_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { FeeForm, RecordPaymentForm, VoidPaymentForm } from "../../forms";

export const metadata: Metadata = { title: "Estado de cuenta" };

/** Estado de cuenta de un alumno: lo que debe, registrar un pago y sus recibos. */
export default async function StudentAccountPage({ params }: PageProps<"/panel/pagos/alumno/[id]">) {
  const session = await requireRole("admin", "secretaria");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const acct = await academic.studentAccount(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  });
  const pending = acct.charges.filter((c) => c.status === "pendiente");
  const paid = acct.charges.filter((c) => c.status === "pagado");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/pagos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Pagos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{acct.studentName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {acct.sectionLabel ?? "Sin matrícula este año"} · Debe {formatLempiras(acct.pendingCents)}
          {acct.overdueCents > 0 && ` (vencido ${formatLempiras(acct.overdueCents)})`} ·{" "}
          <Link href={`/panel/alumnos/${id}`} className="font-medium text-brand-700 hover:underline">
            Ficha del alumno
          </Link>
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 font-semibold text-slate-900">Registrar un pago en la oficina</h2>
            {pending.length === 0 ? (
              <p className="text-sm text-slate-500">No debe nada.</p>
            ) : (
              <RecordPaymentForm studentId={id} charges={pending} />
            )}
          </section>

          <section className="card overflow-hidden">
            <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              Pagos y recibos
            </h2>
            {acct.payments.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Todavía no hay pagos.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {acct.payments.map((p) => (
                  <li key={p.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/panel/pagos/recibo/${p.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        Recibo {p.receiptNumber}
                      </Link>
                      <span
                        className={`tabular-nums ${p.status === "anulado" ? "text-slate-400 line-through" : ""}`}
                      >
                        {formatLempiras(p.amountCents)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {PAYMENT_METHOD_LABELS[p.method]} · {p.items.map((i) => i.name).join(", ")} · {p.byName}
                      {p.status === "anulado" && ` · ANULADO: ${p.voidReason}`}
                    </p>
                    {p.reference?.startsWith("PAGO DOBLE") && p.status !== "anulado" && (
                      <p className="text-xs font-semibold text-amber-700">
                        {p.reference} Si se devuelve el dinero, anula este pago.
                      </p>
                    )}
                    {session.user.role === "admin" && p.status === "confirmado" && (
                      <VoidPaymentForm id={p.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {paid.length > 0 && (
            <p className="text-xs text-slate-500">
              Pagado: {paid.map((c) => `${c.name} (${formatDay(c.dueOn)})`).join(" · ")}
            </p>
          )}
        </div>

        <aside className="card h-fit p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Cobro solo a este alumno</h2>
          <FeeForm grades={[]} sections={[]} studentId={id} />
        </aside>
      </div>
    </div>
  );
}
