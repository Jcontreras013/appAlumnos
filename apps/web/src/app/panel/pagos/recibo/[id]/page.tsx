import { formatDate, formatLempiras, PAYMENT_METHOD_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Recibo" };

/** Recibo de pago, listo para imprimir. La oficina, la familia del alumno o el alumno que paga lo suyo. */
export default async function ReceiptPage({ params, searchParams }: PageProps<"/panel/pagos/recibo/[id]">) {
  const session = await requireRole("admin", "secretaria", "padre", "estudiante");
  const { id } = await params;
  const { nuevo } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await academic.payment(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  });
  const family = session.user.role === "padre";
  const when = p.confirmedAt ?? p.createdAt;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={
            session.user.role === "estudiante"
              ? "/panel/pagos/mis-pagos"
              : family
                ? "/panel/pagos/familia"
                : `/panel/pagos/alumno/${p.studentId}`
          }
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← {family ? "Pagos" : session.user.role === "estudiante" ? "Mis pagos" : "Estado de cuenta"}
        </Link>
        <PrintButton />
      </div>
      {nuevo && (
        <p
          role="status"
          className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 print:hidden"
        >
          Pago registrado.
        </p>
      )}
      <article className="card space-y-5 p-6 print:border-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">{session.school?.name}</p>
            <p className="text-sm text-slate-500">Recibo de pago</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Número</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{p.receiptNumber}</p>
          </div>
        </header>
        {p.status === "anulado" && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            ANULADO: {p.voidReason}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-500">Alumno</dt>
            <dd className="font-medium text-slate-900">{p.studentName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Sección</dt>
            <dd className="font-medium text-slate-900">{p.sectionLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Fecha</dt>
            <dd className="font-medium text-slate-900">{formatDate(when)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Forma de pago</dt>
            <dd className="font-medium text-slate-900">
              {PAYMENT_METHOD_LABELS[p.method]}
              {p.reference && ` · ${p.reference}`}
            </dd>
          </div>
        </dl>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 font-semibold">Concepto</th>
              <th className="py-2 text-right font-semibold">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {p.items.map((i) => (
              <tr key={i.name}>
                <td className="py-2">{i.name}</td>
                <td className="py-2 text-right tabular-nums">{formatLempiras(i.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300">
              <td className="py-2 font-semibold">Total</td>
              <td className="py-2 text-right text-base font-bold tabular-nums">
                {formatLempiras(p.amountCents)}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="text-xs text-slate-500">
          {p.method === "tarjeta" ? `Pagado en línea por ${p.byName}.` : `Recibió: ${p.byName}.`}
        </p>
      </article>
    </div>
  );
}
