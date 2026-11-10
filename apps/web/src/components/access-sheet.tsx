"use client";

import { toCsv } from "@escolar/shared";

export interface AccessEntry {
  name: string;
  /** Cargo o centro. */
  detail: string;
  login: string;
  password: string | null;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * Hoja de accesos para recortar y entregar a cada persona (o descargar en Excel). Las contraseñas
 * temporales solo se muestran una vez: después de cerrar esta pantalla no se pueden volver a ver.
 */
export function AccessSheet({ title, entries }: { title: string; entries: AccessEntry[] }) {
  const withPassword = entries.filter((e) => e.password);

  function print() {
    const site = window.location.origin;
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) return;
    const slips = withPassword
      .map(
        (
          e,
        ) => `<div class="slip"><p class="muted">${escapeHtml(title)}</p><p class="name">${escapeHtml(e.name)}</p>
<p class="muted">${escapeHtml(e.detail)}</p><p>Entre a: <b>${escapeHtml(site)}</b></p>
<p>Usuario: <span class="mono">${escapeHtml(e.login)}</span></p>
<p>Contraseña temporal: <span class="mono">${escapeHtml(e.password ?? "")}</span></p>
<p class="muted small">Al entrar, el sistema le pedirá crear su propia contraseña.</p></div>`,
      )
      .join("");
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Accesos</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#0f172a}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.slip{border:2px dashed #94a3b8;border-radius:10px;padding:12px 16px;break-inside:avoid}.slip p{margin:4px 0}
.name{font-size:17px;font-weight:700}.muted{color:#475569}.small{font-size:12px}.mono{font-family:ui-monospace,monospace;font-weight:700;font-size:16px}</style></head>
<body><div class="grid">${slips}</div><script>window.onload=()=>window.print()</script></body></html>`);
    win.document.close();
  }

  function download() {
    const csv = toCsv([
      ["Nombre", "Cargo o centro", "Usuario", "Contraseña temporal"],
      ...entries.map((e) => [
        e.name,
        e.detail,
        e.login,
        e.password ?? "(ya tenía cuenta: usa su contraseña)",
      ]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "accesos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {withPassword.length > 0 && (
        <button type="button" className="btn-primary" onClick={print}>
          Imprimir hoja de accesos ({withPassword.length})
        </button>
      )}
      <button type="button" className="btn-secondary" onClick={download}>
        Descargar lista (Excel)
      </button>
    </div>
  );
}
