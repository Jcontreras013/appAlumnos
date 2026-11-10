import { STAFF_IMPORT_COLUMNS, toCsv } from "@escolar/shared";
import { requireRole } from "@/lib/dal";

/** Plantilla CSV (se abre en Excel) para cargar al personal de un centro. Datos de ejemplo ficticios. */
export async function GET() {
  await requireRole("admin");
  const csv = toCsv([
    STAFF_IMPORT_COLUMNS.map((c) => c.label),
    ["María Fernanda López", "0000-1990-00001", "", "docente"],
    ["José Antonio Reyes", "0000-1985-00002", "jose.reyes@correo.hn", "coordinador"],
    ["Ana Lucía Martínez", "0000-1992-00003", "", "secretaria"],
  ]);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="plantilla-personal.csv"',
    },
  });
}
