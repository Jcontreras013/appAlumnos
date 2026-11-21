import { DOCUMENT_VISIBILITY_LABELS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { copyDocumentAction, deleteDocumentAction } from "../actions";
import { DocumentEditor } from "./document-editor";
import { DownloadWordButton } from "./download-word";

export const metadata: Metadata = { title: "Documento" };

export default async function DocumentPage({ params }: PageProps<"/panel/documentos/[id]">) {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const doc = await academic.getDocument(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const schoolName = session.school?.name ?? "";
  const logoUrl = session.school?.logoVersion ? `/panel/logo?v=${session.school.logoVersion}` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/panel/documentos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Documentos
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <form action={copyDocumentAction}>
            <input type="hidden" name="id" value={doc.id} />
            <button type="submit" className="btn-secondary px-3 py-1.5">
              Hacer una copia
            </button>
          </form>
          {doc.canEdit && (
            <form action={deleteDocumentAction}>
              <input type="hidden" name="id" value={doc.id} />
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-semibold text-slate-500 hover:text-red-700"
                aria-label={`Borrar el documento ${doc.title}`}
              >
                Borrar
              </button>
            </form>
          )}
        </div>
      </div>

      {doc.canEdit ? (
        <DocumentEditor doc={doc} schoolName={schoolName} logoUrl={logoUrl} />
      ) : (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{doc.title}</h1>
              <p className="text-sm text-slate-500">
                De {doc.authorName} · {DOCUMENT_VISIBILITY_LABELS[doc.visibility]} · Solo lectura: para
                cambiarlo, haz una copia.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DownloadWordButton
                title={doc.title}
                content={doc.content}
                schoolName={schoolName}
                logoUrl={logoUrl}
              />
              <Link href={`/panel/documentos/${doc.id}/imprimir`} className="btn-secondary">
                Imprimir o PDF
              </Link>
            </div>
          </div>
          <article className="card px-6 py-5 sm:px-10">
            <DocumentView content={doc.content} />
          </article>
        </>
      )}
    </div>
  );
}
