"use client";

/** Imprimir (o "Guardar como PDF" desde el diálogo de impresión del navegador o del teléfono). */
export function PrintButton({ label = "Imprimir o guardar PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-primary print:hidden" onClick={() => window.print()}>
      {label}
    </button>
  );
}
