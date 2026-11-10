import { SCHOOL_IMPORT_COLUMNS, toCsv } from "@escolar/shared";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";

/** Plantilla CSV para cargar los centros del departamento (con los distritos reales). Datos ficticios. */
export async function GET() {
  const session = await requireRole("director_departamental");
  const [department] = await identity.listDepartments(session.accessToken);
  const district = department?.districts[0]?.name ?? "Distrito";
  const csv = toCsv([
    SCHOOL_IMPORT_COLUMNS.map((c) => c.label),
    ["CEB Ejemplo Uno", "", district, "Nombre del Director", "0000-1975-00001", ""],
    ["Escuela Ejemplo Dos", "", district, "Nombre de la Directora", "", "directora@correo.hn"],
  ]);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="plantilla-centros.csv"',
    },
  });
}
