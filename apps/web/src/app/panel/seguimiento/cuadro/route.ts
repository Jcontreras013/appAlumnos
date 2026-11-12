import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { fileSlug, xlsxResponse } from "@/lib/download";

const querySchema = z.object({ seccion: z.uuid(), periodo: z.uuid().optional() });

/**
 * Cuadro de calificaciones de una sección en un parcial, en Excel: una fila por alumno con su
 * identidad (como texto, para que Excel no le quite el cero inicial) y la nota de cada materia. Es
 * lo que se transcribe al SACE al cierre del parcial.
 */
export async function GET(request: Request) {
  const session = await requireRole("admin", "coordinador", "secretaria");
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse({ ...params, periodo: params.periodo || undefined });
  if (!parsed.success) return new Response("Elige la sección", { status: 400 });

  try {
    const report = await academic.gradesReport(session.accessToken, parsed.data.seccion, parsed.data.periodo);
    const rows = report.students.map((student, i) => {
      const pendingNotes: string[] = [];
      const grades = report.subjects.map((s) => {
        const g = student.grades[s.assignmentId];
        if (!g || g.grade === null) {
          pendingNotes.push(
            `${s.subjectName}: evaluado ${g?.possible ?? 0} de 100 (lleva ${g?.points ?? 0})`,
          );
          return null;
        }
        if (g.grade < report.passingGrade) pendingNotes.push(`Reprueba ${s.subjectName}`);
        return g.grade;
      });
      return [i + 1, student.nationalId, student.name, ...grades, pendingNotes.join("; ")];
    });
    const filename = `cuadro-${fileSlug(report.section.label)}-${fileSlug(report.period.name)}.xlsx`;
    return xlsxResponse(filename, [
      {
        name: `${report.section.label} ${report.period.name}`,
        columns: [
          { header: "N°", type: "number", width: 5 },
          { header: "Identidad", width: 16 },
          { header: "Alumno", width: 32 },
          ...report.subjects.map((s) => ({ header: s.subjectName, type: "number" as const, width: 12 })),
          { header: "Observaciones", width: 50 },
        ],
        rows,
      },
    ]);
  } catch (err) {
    if (err instanceof ServiceError && err.status < 500)
      return new Response(err.message, { status: err.status });
    throw err;
  }
}
