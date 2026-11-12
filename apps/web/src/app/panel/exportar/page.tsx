import type { Metadata } from "next";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Exportar datos" };

const SHEETS = [
  {
    name: "Alumnos",
    detail:
      "Todos los alumnos del centro con su identidad, fecha de nacimiento, grado, sección, estado de la matrícula y responsable principal.",
  },
  {
    name: "Notas",
    detail:
      "Una fila por alumno y materia, con la nota de cada parcial y el promedio. Un parcial sin sus 100 puntos repartidos queda vacío.",
  },
  {
    name: "Asistencia",
    detail:
      "Por alumno: días registrados, presentes, tardes, ausencias, justificadas y porcentaje de asistencia.",
  },
  { name: "Asistencia diaria", detail: "El detalle de cada día que se pasó lista." },
];

export default async function ExportPage() {
  const session = await requireRole("admin", "coordinador", "secretaria");
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Exportar datos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Los datos del año vigente de {session.school?.name} en un archivo de Excel. Los datos son de la
          Secretaría de Educación: descárgalos cuando te los pidan o para tu propio archivo.
        </p>
      </div>

      <section className="card divide-y divide-slate-100">
        {SHEETS.map((s) => (
          <div key={s.name} className="px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Hoja «{s.name}»</h2>
            <p className="mt-0.5 text-sm text-slate-600">{s.detail}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <a href="/panel/exportar/descargar" className="btn-primary" download>
          Descargar Excel del centro
        </a>
        <p className="text-xs text-slate-500">
          Son datos de menores: guárdalos con cuidado. Cada descarga queda registrada con tu nombre.
        </p>
      </div>
    </div>
  );
}
