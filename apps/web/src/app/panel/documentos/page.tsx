import {
  DOCUMENT_TEMPLATE_INFO,
  DOCUMENT_TEMPLATES,
  DOCUMENT_VISIBILITY_LABELS,
  type DocumentSummaryDto,
  formatDate,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { createDocumentAction } from "./actions";

export const metadata: Metadata = { title: "Documentos" };

export default async function DocumentsPage() {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const docs = await academic.listDocuments(session.accessToken);
  const mine = docs.filter((d) => d.mine);
  const shared = docs.filter((d) => !d.mine);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Documentos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Circulares, actas, informes y listados con tablas, escritos aquí mismo. Se descargan en Word o se
          imprimen y guardan en PDF con el membrete del centro.
        </p>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Nuevo documento</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {DOCUMENT_TEMPLATES.map((t) => (
            <form key={t} action={createDocumentAction}>
              <input type="hidden" name="template" value={t} />
              <button
                type="submit"
                className="h-full w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-500 hover:bg-brand-50"
              >
                <span className="block font-semibold text-slate-900">{DOCUMENT_TEMPLATE_INFO[t].label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {DOCUMENT_TEMPLATE_INFO[t].description}
                </span>
              </button>
            </form>
          ))}
        </div>
      </section>

      <DocList
        title="Mis documentos"
        docs={mine}
        empty="Todavía no tienes documentos. Empieza con una plantilla."
      />
      {shared.length > 0 && <DocList title="Compartidos por el personal" docs={shared} empty="" showAuthor />}
    </div>
  );
}

function DocList({
  title,
  docs,
  empty,
  showAuthor = false,
}: {
  title: string;
  docs: DocumentSummaryDto[];
  empty: string;
  showAuthor?: boolean;
}) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
        {title}
      </h2>
      {docs.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`/panel/documentos/${d.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{d.title}</span>
                <span className="text-xs text-slate-500">
                  {DOCUMENT_TEMPLATE_INFO[d.template]?.label ?? "Documento"}
                  {showAuthor ? ` · ${d.authorName}` : ""}
                </span>
                {!showAuthor && d.visibility === "personal" && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    {DOCUMENT_VISIBILITY_LABELS.personal}
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-400">Actualizado {formatDate(d.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
