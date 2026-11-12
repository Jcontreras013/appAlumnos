import type { Relationship } from "./enrollment";
import type { AttendanceStatus } from "./evaluation";
import type { RegionalSchoolSummaryDto } from "./staff";

/**
 * Datos para exportar a Excel. Los datos son de la Secretaría de Educación: la dirección descarga los
 * de su centro y la departamental los de su ámbito cuando los necesite.
 */

export interface ExportStudentRow {
  nationalId: string | null;
  lastNames: string;
  firstNames: string;
  birthDate: string | null;
  sex: "F" | "M" | null;
  gradeName: string | null;
  sectionName: string | null;
  /** Matrícula del año vigente (null = sin matrícula este año). */
  status: "activa" | "retirada" | null;
  enrolledOn: string | null;
  withdrawnOn: string | null;
  guardianName: string | null;
  guardianRelationship: Relationship | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  guardianNationalId: string | null;
}

export interface ExportGradeRow {
  gradeName: string;
  sectionName: string;
  nationalId: string | null;
  studentName: string;
  subjectName: string;
  teacherName: string;
  /** Nota de cada parcial, en el orden de `periods`; null si todavía no está evaluado completo. */
  periods: Array<number | null>;
  /** Promedio de los parciales ya completos. */
  average: number | null;
}

export interface ExportAttendanceRow {
  gradeName: string;
  sectionName: string;
  nationalId: string | null;
  studentName: string;
  days: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  /** Asistencia efectiva (0 a 1): llegar tarde cuenta como asistió y la justificada no penaliza. */
  rate: number | null;
}

export interface ExportAttendanceDayRow {
  date: string;
  gradeName: string;
  sectionName: string;
  nationalId: string | null;
  studentName: string;
  status: AttendanceStatus;
}

export interface SchoolExportDto {
  schoolYear: string | null;
  generatedOn: string;
  periods: string[];
  students: ExportStudentRow[];
  grades: ExportGradeRow[];
  attendance: ExportAttendanceRow[];
  attendanceDays: ExportAttendanceDayRow[];
}

export interface RegionalExportStudentRow extends ExportStudentRow {
  schoolName: string;
  schoolCode: string | null;
  districtName: string | null;
}

export interface RegionalExportDto {
  generatedOn: string;
  schools: Array<RegionalSchoolSummaryDto & { schoolCode: string | null }>;
  students: RegionalExportStudentRow[];
}
