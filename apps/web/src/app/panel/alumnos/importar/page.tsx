import { IMPORT_COLUMNS } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importar alumnos" };

export default async function ImportPage() {
  const session = await requireRole("admin", "secretaria");
  const [years, sections] = await Promise.all([
    academic.listYears(session.accessToken),
    academic.listSections(session.accessToken),
  ]);
  const current = years.find((y) => y.isCurrent);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/panel/alumnos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Alumnos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Importar alumnos desde Excel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sube el listado del colegio y quedarán registrados y matriculados en el año{" "}
          {current?.name ?? "vigente"}. Primero verás una vista previa: no se guarda nada hasta que confirmes.
        </p>
      </div>

      {!current || sections.length === 0 ? (
        <div className="card p-5 text-sm text-slate-700">
          Antes de importar, crea el año lectivo vigente y sus secciones en{" "}
          <Link href="/panel/estructura" className="font-semibold text-brand-700 hover:underline">
            Estructura académica
          </Link>
          .
        </div>
      ) : (
        <>
          <section className="card space-y-3 p-5 text-sm text-slate-700">
            <h2 className="font-semibold text-slate-900">Cómo preparar el archivo</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Descarga la{" "}
                <a
                  href="/panel/alumnos/importar/plantilla"
                  className="font-semibold text-brand-700 hover:underline"
                >
                  plantilla
                </a>{" "}
                o usa tu propio Excel con encabezados parecidos (se reconocen sin importar tildes ni
                mayúsculas).
              </li>
              <li>
                Obligatorias:{" "}
                {IMPORT_COLUMNS.filter((c) => c.required)
                  .map((c) => c.label)
                  .join(", ")}
                , y teléfono o correo del responsable.
              </li>
              <li>Grado y sección deben existir este año: {sections.map((s) => s.label).join(", ")}.</li>
              <li>Hermanos: pon la misma identidad del responsable y quedarán en la misma familia.</li>
            </ol>
          </section>
          <ImportWizard />
        </>
      )}
    </div>
  );
}
