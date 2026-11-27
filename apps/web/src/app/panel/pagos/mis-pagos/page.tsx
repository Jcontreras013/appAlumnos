import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { AccountCard } from "../account-card";

export const metadata: Metadata = { title: "Mis pagos" };

/**
 * El alumno que responde por sí mismo (mayor de edad, o paga él su colegiatura): sus cobros, pagar con
 * tarjeta y sus recibos. A los demás alumnos los pagos los ve su familia.
 */
export default async function MyPaymentsPage({ searchParams }: PageProps<"/panel/pagos/mis-pagos">) {
  const session = await requireRole("estudiante");
  const { cancelado } = await searchParams;
  const account = await academic.myAccount(session.accessToken).catch((err) => {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mis pagos</h1>
        <p className="mt-1 text-sm text-slate-500">Lo que debes al centro y tus recibos.</p>
      </div>
      {cancelado && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          No se hizo el cobro: cancelaste el pago. Puedes intentarlo de nuevo cuando quieras.
        </p>
      )}
      <AccountCard account={account} email={session.user.email ?? ""} />
    </div>
  );
}
