import { toCsv } from "@escolar/shared";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

const querySchema = z.object({ seccion: z.uuid(), periodo: z.uuid().optional() });

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Cuadro de calificaciones de una sección en un parcial, en CSV para Excel: una fila por alumno con
 * su identidad y la nota de cada materia. Es lo que se transcribe al SACE al cierre del parcial.
 */
export async function GET(request: Request) {
  const session = await requireRole("admin", "coordinador", "secretaria");
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse({ ...params, periodo: params.periodo || undefined });
  if (!parsed.success) return new Response("Elige la sección", { status: 400 });

  try {
    const report = await academic.gradesReport(session.accessToken, parsed.data.seccion, parsed.data.periodo);
    const header = [
      "N°",
      "Identidad",
      "Alumno",
      ...report.subjects.map((s) => s.subjectName),
      "Observaciones",
    ];
    const rows = report.students.map((student, i) => {
      const pendingNotes: string[] = [];
      const grades = report.subjects.map((s) => {
        const g = student.grades[s.assignmentId];
        if (!g || g.grade === null) {
          pendingNotes.push(
            `${s.subjectName}: evaluado ${g?.possible ?? 0} de 100 (lleva ${g?.points ?? 0})`,
          );
          return "";
        }
        if (g.grade < report.passingGrade) pendingNotes.push(`Reprueba ${s.subjectName}`);
        return String(g.grade);
      });
      return [String(i + 1), student.nationalId ?? "", student.name, ...grades, pendingNotes.join("; ")];
    });
    const csv = toCsv([header, ...rows]);
    const filename = `cuadro-${slug(report.section.label)}-${slug(report.period.name)}.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError && err.status < 500)
      return new Response(err.message, { status: err.status });
    throw err;
  }
}
