"use client";

export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <h2 className="text-lg font-semibold text-slate-900">No se pudo cargar esta pantalla</h2>
      <p className="mt-2 text-sm text-slate-600">
        Puede ser un problema de conexión con el servidor. Si se repite, comparte esta referencia con soporte.
      </p>
      {error.digest && <p className="mt-3 font-mono text-xs text-slate-400">Ref: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn-primary mt-5">
        Reintentar
      </button>
    </div>
  );
}
