"use client";

import type { DocContent } from "@escolar/shared";
import { useState } from "react";

/** Descarga el documento en Word (.docx). La librería se carga solo al pedirlo. */
export function DownloadWordButton({
  title,
  content,
  getContent,
  schoolName,
  logoUrl,
}: {
  title: string;
  /** El contenido guardado (vista de solo lectura)… */
  content?: DocContent;
  /** …o lo que hay en el editor en este momento, aunque no se haya guardado. */
  getContent?: () => DocContent;
  schoolName: string;
  logoUrl: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { downloadDocx } = await import("@/lib/docx-export");
            const current = getContent?.() ?? content;
            if (!current) return;
            await downloadDocx({ title, content: current, schoolName, logoUrl });
          } catch {
            setError("No se pudo preparar el archivo de Word. Intenta de nuevo.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparando…" : "Descargar Word"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
    </>
  );
}
