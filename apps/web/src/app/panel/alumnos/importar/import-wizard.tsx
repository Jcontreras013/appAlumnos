"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { confirmImportAction, type ImportState, previewImportAction } from "../actions";

function Submit({ children, pending: pendingText }: { children: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function ImportWizard() {
  const [preview, previewAction] = useActionState(previewImportAction, {} as ImportState);
  const [confirmed, confirmAction] = useActionState(confirmImportAction, {} as ImportState);
  const [onlyErrors, setOnlyErrors] = useState(true);

  // Si la confirmación falló con errores nuevos, se muestran esos; si no, los de la vista previa.
  const state = confirmed.result || confirmed.error ? confirmed : preview;
  const result = state.result;
  const withErrors = result ? result.rows.filter((r) => r.errors.length > 0) : [];
  const shown = result ? (onlyErrors && withErrors.length ? withErrors : result.rows) : [];

  return (
    <div className="space-y-6">
      <form action={previewAction} className="card flex flex-wrap items-end gap-4 p-5">
        <div className="min-w-64 flex-1">
          <label htmlFor="archivo" className="label">
            Archivo (.xlsx o .csv, hasta 4 MB)
          </label>
          <input
            id="archivo"
            name="archivo"
            type="file"
            accept=".xlsx,.csv"
            required
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
          />
        </div>
        <Submit pending="Revisando…">Ver vista previa</Submit>
      </form>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      {result && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <h2 className="font-semibold text-slate-900">
                Vista previa{preview.fileName ? ` de ${preview.fileName}` : ""}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {result.total} filas · <strong className="text-brand-700">{result.valid} listas</strong>
                {withErrors.length > 0 && (
                  <>
                    {" "}
                    · <strong className="text-red-700">{withErrors.length} con errores</strong>
                  </>
                )}
                {result.guardiansReused > 0 &&
                  ` · ${result.guardiansReused} con responsable compartido (hermanos)`}
              </p>
            </div>
            {withErrors.length === 0 && state.payload ? (
              <form action={confirmAction}>
                <input type="hidden" name="payload" value={state.payload} />
                <Submit pending="Importando…">{`Importar ${result.valid} alumnos`}</Submit>
              </form>
            ) : (
              <p className="max-w-sm text-sm text-slate-600">
                Corrige las filas marcadas en tu archivo y vuelve a subirlo. No se importa nada hasta que
                todas estén bien.
              </p>
            )}
          </div>

          {withErrors.length > 0 && (
            <label className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(e) => setOnlyErrors(e.target.checked)}
                className="size-4 accent-brand-600"
              />
              Mostrar solo las filas con errores
            </label>
          )}

          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Fila</th>
                  <th className="px-4 py-2 font-semibold">Alumno</th>
                  <th className="px-4 py-2 font-semibold">Sección</th>
                  <th className="px-4 py-2 font-semibold">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <tr key={r.row} className={r.errors.length ? "bg-red-50/40" : ""}>
                    <td className="px-4 py-2 tabular-nums text-slate-500">{r.row}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{r.student}</td>
                    <td className="whitespace-nowrap px-4 py-2">{r.section ?? "—"}</td>
                    <td className="px-4 py-2">
                      {r.errors.length === 0 ? (
                        <span className="text-brand-700">Lista</span>
                      ) : (
                        <ul className="space-y-0.5 text-red-700">
                          {r.errors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
