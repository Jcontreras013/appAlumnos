import { IMPORT_COLUMNS, toCsv } from "@escolar/shared";
import { requireRole } from "@/lib/dal";

/** Plantilla CSV (se abre directo en Excel) con los encabezados que reconoce la importación. */
export async function GET() {
  await requireRole("admin", "secretaria");
  const csv = toCsv([
    IMPORT_COLUMNS.map((c) => c.label),
    [
      "Ana Sofía",
      "López Castro",
      "0801-2019-00001",
      "21/03/2019",
      "F",
      "Primer grado",
      "A",
      "María Castro",
      "Madre",
      "0801-1985-01234",
      "9988-7766",
      "maria@correo.hn",
      "Alergia al maní",
    ],
    [
      "Luis",
      "López Castro",
      "",
      "05/08/2016",
      "M",
      "Cuarto grado",
      "B",
      "María Castro",
      "Madre",
      "0801-1985-01234",
      "9988-7766",
      "",
      "",
    ],
  ]);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="plantilla-alumnos.csv"',
    },
  });
}
