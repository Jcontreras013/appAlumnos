import { formatDate, formatFileSize, LIBRARY_FILE_TYPES } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { libraryFileUrl } from "@/lib/library-urls";
import { PdfReader } from "./pdf-reader";
import { SaveOffline } from "./save-offline";

export const metadata: Metadata = { title: "Biblioteca" };

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente", "padre", "estudiante");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const item = await academic.libraryItem(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  });
  const pdf = item.file?.contentType === "application/pdf";
  const place = [item.gradeName ?? "Todo el centro", item.subjectName].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <Link href="/panel/biblioteca" className="text-sm text-slate-500 hover:text-slate-900">
        ← Biblioteca
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{item.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {place}
            {item.file
              ? ` · ${LIBRARY_FILE_TYPES[item.file.contentType]?.label ?? "Archivo"}, ${formatFileSize(item.file.size)}`
              : ""}
            {` · ${item.uploadedByName}, ${formatDate(item.createdAt)}`}
          </p>
          {item.description && <p className="mt-2 text-sm text-slate-700">{item.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.kind === "enlace" && item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
              Abrir enlace
            </a>
          )}
          {item.file && (
            <a href={libraryFileUrl(item.id)} download={item.file.name} className="btn-secondary">
              Descargar
            </a>
          )}
          {item.file && <SaveOffline id={item.id} size={item.file.size} />}
        </div>
      </div>

      {pdf ? (
        <PdfReader id={item.id} />
      ) : item.file ? (
        <p className="card p-6 text-sm text-slate-600">
          Este archivo se abre con {LIBRARY_FILE_TYPES[item.file.contentType]?.label ?? "su programa"}: tócalo
          en «Descargar» y ábrelo en el teléfono o la computadora.
        </p>
      ) : null}
    </div>
  );
}
