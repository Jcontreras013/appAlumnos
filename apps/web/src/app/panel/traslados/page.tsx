import { formatDay, type TransferDto } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { TransferHistory } from "@/components/transfer-history";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { cancelTransferAction } from "./actions";
import { ReceiveTransferForm } from "./forms";

export const metadata: Metadata = { title: "Traslados" };

const STATUS: Record<TransferDto["status"], string> = {
  pendiente: "Pendiente",
  recibido: "Recibido",
  cancelado: "Anulado",
};

export default async function TransfersPage() {
  const session = await requireRole("admin", "secretaria");
  const [{ incoming, outgoing }, sections] = await Promise.all([
    academic.transfers(session.accessToken),
    academic.listSections(session.accessToken),
  ]);
  const pending = incoming.filter((t) => t.status === "pendiente");
  const options = sections.map((s) => ({ value: s.id, label: s.label }));
  const history = [...incoming.filter((t) => t.status !== "pendiente"), ...outgoing].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Traslados</h1>
        <p className="mt-1 text-sm text-slate-500">
          Alumnos que llegan de otros centros del departamento. Para trasladar a un alumno a otro centro,
          entra a su ficha.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">Por recibir ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="card p-6 text-center text-sm text-slate-500">No hay traslados por recibir.</p>
        ) : (
          pending.map((t) => (
            <article key={t.id} className="card space-y-4 p-5">
              <h3 className="text-lg font-semibold text-slate-900">{t.studentName}</h3>
              <TransferHistory transfer={t} />
              <p className="text-xs text-slate-500">
                Responsables: {t.snapshot.guardians.map((g) => g.fullName).join(", ")}
              </p>
              <ReceiveTransferForm id={t.id} sections={options} />
            </article>
          ))
        )}
      </section>

      {history.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
            Últimos dos meses
          </h2>
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {history.map((t) => {
                const sent = outgoing.includes(t);
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {t.studentId ? (
                        <Link href={`/panel/alumnos/${t.studentId}`} className="hover:underline">
                          {t.studentName}
                        </Link>
                      ) : (
                        t.studentName
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {sent ? `A ${t.toSchoolName}` : `De ${t.fromSchoolName}`} · {formatDay(t.date)}
                    </td>
                    <td className="px-4 py-2">{STATUS[t.status]}</td>
                    <td className="px-4 py-2 text-right">
                      {sent && t.status === "pendiente" && (
                        <form action={cancelTransferAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <button
                            type="submit"
                            className="text-xs font-semibold text-slate-500 hover:text-red-700"
                          >
                            Anular
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
