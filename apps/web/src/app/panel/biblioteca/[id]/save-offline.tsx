"use client";

import { formatFileSize } from "@escolar/shared";
import { useEffect, useState } from "react";
import { removeSavedLibraryFile, savedLibraryIds, saveLibraryFile } from "@/lib/library-offline";

type State =
  | { kind: "checking" }
  | { kind: "not-saved" }
  | { kind: "saving"; progress: number }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/** «Guardar para leer sin internet»: baja el libro una vez y queda en el teléfono. */
export function SaveOffline({ id, size }: { id: string; size: number }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    void savedLibraryIds().then((ids) => setState({ kind: ids.has(id) ? "saved" : "not-saved" }));
  }, [id]);

  async function save() {
    setState({ kind: "saving", progress: 0 });
    const result = await saveLibraryFile(id, (progress) => setState({ kind: "saving", progress }));
    setState(result.ok ? { kind: "saved" } : { kind: "error", message: result.error });
  }

  async function remove() {
    await removeSavedLibraryFile(id);
    setState({ kind: "not-saved" });
  }

  if (state.kind === "checking") return null;
  if (state.kind === "saved") {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
          ✓ Guardado para leer sin internet
        </span>
        <button type="button" className="text-slate-500 underline hover:text-slate-900" onClick={remove}>
          Quitar del teléfono
        </button>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" className="btn-secondary" onClick={save} disabled={state.kind === "saving"}>
        {state.kind === "saving"
          ? `Guardando… ${Math.round(state.progress * 100)} %`
          : `Guardar para leer sin internet (${formatFileSize(size)})`}
      </button>
      {state.kind === "error" && (
        <span className="text-xs font-medium text-red-700" role="alert">
          {state.message}
        </span>
      )}
    </span>
  );
}
