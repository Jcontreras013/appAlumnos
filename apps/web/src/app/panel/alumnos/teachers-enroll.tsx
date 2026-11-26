import { setTeachersEnrollAction } from "./actions";

/**
 * La dirección decide si cada maestro matricula a los alumnos de las secciones donde da clase. Así, en
 * tiempo de matrícula, la dirección y la secretaría quedan más libres.
 */
export function TeachersEnrollToggle({ enabled }: { enabled: boolean }) {
  return (
    <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-900">
          Matrícula por los maestros{" "}
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              enabled ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {enabled ? "Activada" : "Desactivada"}
          </span>
        </p>
        <p className="mt-0.5 text-slate-500">
          {enabled
            ? "Cada maestro registra y matricula a los alumnos de las secciones donde da clase. Retiros, traslados y accesos siguen en la secretaría."
            : "Actívala para que cada maestro matricule a los alumnos de las secciones donde da clase."}
        </p>
      </div>
      <form action={setTeachersEnrollAction}>
        <input type="hidden" name="teachersEnroll" value={enabled ? "no" : "si"} />
        <button type="submit" className={enabled ? "btn-secondary" : "btn-primary"}>
          {enabled ? "Desactivar" : "Activar"}
        </button>
      </form>
    </section>
  );
}
