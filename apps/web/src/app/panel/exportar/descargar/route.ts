import { ATTENDANCE_LABELS } from "@escolar/shared";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { fileSlug, xlsxResponse } from "@/lib/download";
import { STUDENT_COLUMNS, studentCells } from "@/lib/export-sheets";
import type { SheetColumn } from "@/lib/xlsx";

/**
 * Todos los datos del año vigente del centro en un solo Excel: matrícula, notas de cada parcial,
 * resumen de asistencia y el detalle de cada día. Cada descarga queda en la bitácora.
 */
export async function GET() {
  const session = await requireRole("admin", "coordinador", "secretaria");
  const data = await academic.exportSchool(session.accessToken);
  const place = [
    { header: "Grado", width: 16 },
    { header: "Sección", width: 9 },
    { header: "Identidad", width: 16 },
  ];
  const filename = `datos-${fileSlug(session.school?.name ?? "centro")}-${data.generatedOn}.xlsx`;
  return xlsxResponse(filename, [
    { name: "Alumnos", columns: STUDENT_COLUMNS, rows: data.students.map(studentCells) },
    {
      name: "Notas",
      columns: [
        ...place,
        { header: "Alumno", width: 30 },
        { header: "Materia", width: 20 },
        { header: "Docente", width: 26 },
        ...data.periods.map((p): SheetColumn => ({ header: p, type: "number", width: 11 })),
        { header: "Promedio", type: "number", width: 10 },
      ],
      rows: data.grades.map((g) => [
        g.gradeName,
        g.sectionName,
        g.nationalId,
        g.studentName,
        g.subjectName,
        g.teacherName,
        ...g.periods,
        g.average,
      ]),
    },
    {
      name: "Asistencia",
      columns: [
        ...place,
        { header: "Alumno", width: 30 },
        { header: "Días registrados", type: "number", width: 10 },
        { header: "Presente", type: "number", width: 10 },
        { header: "Tarde", type: "number", width: 8 },
        { header: "Ausente", type: "number", width: 9 },
        { header: "Justificada", type: "number", width: 11 },
        { header: "Asistencia", type: "percent", width: 11 },
      ],
      rows: data.attendance.map((a) => [
        a.gradeName,
        a.sectionName,
        a.nationalId,
        a.studentName,
        a.days,
        a.present,
        a.late,
        a.absent,
        a.justified,
        a.rate,
      ]),
    },
    {
      name: "Asistencia diaria",
      columns: [
        { header: "Fecha", type: "date", width: 12 },
        ...place,
        { header: "Alumno", width: 30 },
        { header: "Estado", width: 20 },
      ],
      rows: data.attendanceDays.map((d) => [
        d.date,
        d.gradeName,
        d.sectionName,
        d.nationalId,
        d.studentName,
        ATTENDANCE_LABELS[d.status],
      ]),
    },
  ]);
}
