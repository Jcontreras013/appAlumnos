import { CHANGE_REQUEST_STATUS_LABELS, formatDate } from "@escolar/shared";
import type { Metadata } from "next";
import { Fold, FoldTag } from "@/components/fold";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { DecideForm } from "./decide-form";

export const metadata: Metadata = { title: "Solicitudes" };

const when = (iso: string) =>
  `${formatDate(iso)} ${new Date(iso).toLocaleTimeString("es-HN", {
    timeZone: "America/Tegucigalpa",
    hour: "numeric",
    minute: "2-digit",
  })}`;

/**
 * Lo que pide la secretaría (grados, secciones, materias y permisos de maestros). La dirección lo
 * confirma o lo rechaza; la secretaría ve cómo van sus solicitudes.
 */
export default async function RequestsPage() {
  const session = await requireRole("admin", "secretaria");
  const director = session.user.role === "admin";
  const requests = await academic.changeRequests(session.accessToken);
  const pending = requests.filter((r) => r.status === "pendiente");
  const answered = requests.filter((r) => r.status !== "pendiente");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {director ? "Solicitudes" : "Mis solicitudes"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {director
            ? "Lo que pide la secretaría: al confirmarlo se crea tal cual. Si algo no se puede (por ejemplo, ya existe), aquí verás por qué."
            : "Los grados, secciones, materias y permisos que pediste. La dirección los confirma; mientras tanto no se crean."}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-900">Por confirmar ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="card p-6 text-center text-sm text-slate-500">
            {director ? "No hay nada pendiente." : "No tienes solicitudes pendientes."}
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="card space-y-3 p-4">
                <div>
                  <p className="font-medium text-slate-900">{r.summary}</p>
                  <p className="text-xs text-slate-500">
                    Pedida por {r.requestedByName} · {when(r.createdAt)}
                  </p>
                </div>
                {director ? (
                  <DecideForm id={r.id} />
                ) : (
                  <FoldTag tone="alert">{CHANGE_REQUEST_STATUS_LABELS.pendiente}</FoldTag>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <Fold title="Respondidas" summary={<FoldTag>{answered.length}</FoldTag>}>
          <ul className="divide-y divide-slate-100">
            {answered.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-900">{r.summary}</p>
                  <p className="text-xs text-slate-500">
                    {r.requestedByName} · {when(r.createdAt)}
                    {r.decidedAt && ` · respondió ${r.decidedByName} el ${when(r.decidedAt)}`}
                  </p>
                  {r.decisionNote && <p className="mt-1 text-xs text-slate-600">«{r.decisionNote}»</p>}
                </div>
                <FoldTag tone={r.status === "aprobada" ? "ok" : "neutral"}>
                  {CHANGE_REQUEST_STATUS_LABELS[r.status]}
                </FoldTag>
              </li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}
