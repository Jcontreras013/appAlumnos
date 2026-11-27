import type { Metadata } from "next";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { AccountCard } from "../account-card";

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
        return <AccountCard key={a.studentId} account={a} email={session.user.email ?? ""} />;
      })}
    </div>
  );
}
