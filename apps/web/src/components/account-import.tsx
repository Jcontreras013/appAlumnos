"use client";

import { ROLE_LABELS, type SchoolImportRowDto, type StaffImportRowDto } from "@escolar/shared";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { type AccessEntry, AccessSheet } from "@/components/access-sheet";
import type { AccountImportState } from "@/lib/import-state";

type Action = (prev: AccountImportState, formData: FormData) => Promise<AccountImportState>;
type Row = StaffImportRowDto | SchoolImportRowDto;

const isSchool = (r: Row): r is SchoolImportRowDto => "schoolName" in r;

const STATUS: Record<Row["status"], { label: string; style: string }> = {
  nuevo: { label: "Cuenta nueva", style: "bg-brand-50 text-brand-700" },
  existente: { label: "Ya tiene cuenta: se le agrega el acceso", style: "bg-sky-50 text-sky-800" },
  ya_tiene_acceso: { label: "Ya tiene acceso: no se hace nada", style: "bg-slate-100 text-slate-600" },
  error: { label: "Con errores", style: "bg-red-100 text-red-800" },
};

function Submit({ children, pending: pendingText }: { children: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/**
 * Asistente de carga de cuentas desde Excel (personal de un centro o centros con su director):
 * vista previa con errores por fila, confirmación de todo o nada y hoja de accesos para entregar.
 */
export function AccountImport({
  kind,
  preview,
  confirm,
  title,
}: {
  kind: "personal" | "centros";
  preview: Action;
  confirm: Action;
  /** Encabezado de la hoja de accesos (nombre del centro o del departamento). */
  title: string;
}) {
  const [previewed, previewAction] = useActionState(preview, {});
  const [confirmed, confirmAction] = useActionState(confirm, {});
  const [onlyErrors, setOnlyErrors] = useState(true);
  const done = confirmed.result && !confirmed.result.dryRun && !confirmed.error;
  const state = confirmed.result || confirmed.error ? confirmed : previewed;
  const result = state.result;
  const rows = (result?.rows ?? []) as Row[];
  const withErrors = rows.filter((r) => r.status === "error");
  const shown = !done && onlyErrors && withErrors.length ? withErrors : rows;

  if (done && result) {
    const entries: AccessEntry[] = rows.map((r) =>
      isSchool(r)
        ? {
            name: r.directorName,
            detail: `Dirección · ${r.schoolName}`,
            login: r.directorLogin ?? "",
            password: r.temporaryPassword,
          }
        : {
            name: r.name,
            detail: r.role ? ROLE_LABELS[r.role] : "",
            login: r.login ?? "",
            password: r.temporaryPassword,
          },
    );
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900"
        >
          <p className="font-semibold">
            Listo:{" "}
            {kind === "centros" ? `${rows.length} centros creados` : `${rows.length} personas procesadas`} y{" "}
            {result.created} cuentas nuevas.
          </p>
          <p className="mt-1">
            Imprime o descarga ahora los accesos:{" "}
            <strong>las contraseñas temporales no se vuelven a mostrar</strong>. Quien ya tenía cuenta entra
            con su contraseña de siempre.
          </p>
        </div>
        <AccessSheet title={title} entries={entries} />
        <ResultTable rows={rows} showPasswords />
      </div>
    );
  }

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
        <Submit pending="Revisando…">Revisar archivo</Submit>
      </form>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      {result && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">
              <strong>{state.fileName}</strong>: {result.valid} filas listas
              {result.invalid > 0 && (
                <span className="font-semibold text-red-700"> · {result.invalid} con errores</span>
              )}
            </p>
            {withErrors.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={onlyErrors}
                  onChange={(e) => setOnlyErrors(e.target.checked)}
                />
                Ver solo las filas con errores
              </label>
            )}
          </div>
          <ResultTable rows={shown} />
          {result.invalid > 0 ? (
            <p className="text-sm text-slate-600">
              Corrige el archivo y vuelve a revisarlo. No se crea nada hasta que no haya errores.
            </p>
          ) : (
            <form action={confirmAction}>
              <input type="hidden" name="payload" value={state.payload ?? ""} />
              <Submit pending="Creando…">
                {kind === "centros"
                  ? `Crear ${result.valid} centros`
                  : `Dar acceso a ${result.valid} personas`}
              </Submit>
            </form>
          )}
        </section>
      )}
    </div>
  );
}

function ResultTable({ rows, showPasswords = false }: { rows: Row[]; showPasswords?: boolean }) {
  const school = rows[0] && isSchool(rows[0]);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Fila</th>
            {school && <th className="px-3 py-2 font-semibold">Centro</th>}
            <th className="px-3 py-2 font-semibold">{school ? "Director(a)" : "Nombre"}</th>
            <th className="px-3 py-2 font-semibold">{school ? "Distrito" : "Cargo"}</th>
            <th className="px-3 py-2 font-semibold">Usuario</th>
            <th className="px-3 py-2 font-semibold">{showPasswords ? "Contraseña temporal" : "Estado"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.row} className={r.status === "error" ? "bg-red-50/50" : undefined}>
              <td className="px-3 py-2 tabular-nums text-slate-500">{r.row}</td>
              {isSchool(r) && (
                <td className="px-3 py-2 font-medium text-slate-900">
                  {r.schoolName}
                  {r.code && <span className="block text-xs text-slate-500">{r.code}</span>}
                </td>
              )}
              <td className="px-3 py-2">{isSchool(r) ? r.directorName : r.name}</td>
              <td className="px-3 py-2">
                {isSchool(r) ? r.districtName : r.role ? ROLE_LABELS[r.role] : "—"}
              </td>
              <td className="px-3 py-2 tabular-nums">{(isSchool(r) ? r.directorLogin : r.login) ?? "—"}</td>
              <td className="px-3 py-2">
                {showPasswords ? (
                  r.temporaryPassword ? (
                    <span className="font-mono font-semibold">{r.temporaryPassword}</span>
                  ) : (
                    <span className="text-xs text-slate-500">Ya tenía cuenta</span>
                  )
                ) : (
                  <>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[r.status].style}`}
                    >
                      {STATUS[r.status].label}
                    </span>
                    {r.errors.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-red-700">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
