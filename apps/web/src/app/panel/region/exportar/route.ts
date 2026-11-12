import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { xlsxResponse } from "@/lib/download";
import { STUDENT_COLUMNS, studentCells } from "@/lib/export-sheets";

/**
 * Para la departamental o distrital: el resumen de cada centro de su ámbito y la matrícula de todos,
 * en un solo Excel. Cada descarga queda en la bitácora.
 */
export async function GET() {
  const session = await requireRole("director_departamental", "director_distrital", "superadmin");
  const data = await academic.exportRegion(session.accessToken);
  const yesNo = (v: boolean) => (v ? "Sí" : "No");
  return xlsxResponse(`centros-${data.generatedOn}.xlsx`, [
    {
      name: "Centros",
      columns: [
        { header: "Centro", width: 34 },
        { header: "Código", width: 12 },
        { header: "Distrito", width: 18 },
        { header: "Año lectivo", width: 11 },
        { header: "Alumnos", type: "number", width: 9 },
        { header: "Secciones", type: "number", width: 10 },
        { header: "Docentes", type: "number", width: 10 },
        { header: "Clases", type: "number", width: 8 },
        { header: "Docentes de licencia hoy", type: "number", width: 13 },
        { header: "Clases sin cubrir hoy", type: "number", width: 12 },
        { header: "Asistencia 7 días", type: "percent", width: 11 },
        { header: "Alumnos en riesgo", type: "number", width: 11 },
        { header: "Parcial vigente", width: 13 },
        { header: "Cierre de notas", type: "date", width: 12 },
        { header: "Clases con notas completas", type: "number", width: 14 },
        { header: "Clases en total", type: "number", width: 10 },
        { header: "Atrasado en notas", width: 11 },
        { header: "Planificaciones entregadas", type: "number", width: 14 },
        { header: "Planificaciones esperadas", type: "number", width: 14 },
        { header: "Planificaciones atrasadas", type: "number", width: 14 },
      ],
      rows: data.schools.map((s) => [
        s.schoolName,
        s.schoolCode,
        s.districtName,
        s.schoolYear,
        s.students,
        s.sections,
        s.teachers,
        s.classes,
        s.teachersOnLeave,
        s.uncoveredClasses,
        s.attendanceRate7d,
        s.studentsAtRisk,
        s.periodName,
        s.periodClosesOn,
        s.gradeProgress.complete,
        s.gradeProgress.total,
        yesNo(s.behindOnGrades),
        s.plans.delivered,
        s.plans.total,
        s.plans.overdue,
      ]),
    },
    {
      name: "Matrícula",
      columns: [
        { header: "Centro", width: 34 },
        { header: "Código", width: 12 },
        { header: "Distrito", width: 18 },
        ...STUDENT_COLUMNS,
      ],
      rows: data.students.map((s) => [s.schoolName, s.schoolCode, s.districtName, ...studentCells(s)]),
    },
  ]);
}
