import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentView } from "@/components/document-view";
import { PrintButton } from "@/components/print-button";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Imprimir documento" };

/** Hoja para imprimir o guardar en PDF, con el membrete del centro (logo y nombre). */
export default async function PrintDocumentPage({ params }: PageProps<"/panel/documentos/[id]/imprimir">) {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const doc = await academic.getDocument(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/panel/documentos/${doc.id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← {doc.title}
        </Link>
        <PrintButton />
      </div>
      <article className="card mx-auto max-w-4xl space-y-6 p-6 print:border-0 print:p-0 print:shadow-none sm:p-10">
        {session.school && (
          <header className="flex items-center justify-center gap-4 border-b-2 border-brand-700 pb-3">
            <SchoolLogo school={session.school} className="size-14" />
            <p className="text-lg font-semibold text-slate-900">{session.school.name}</p>
          </header>
        )}
        <DocumentView content={doc.content} />
      </article>
    </div>
  );
}
