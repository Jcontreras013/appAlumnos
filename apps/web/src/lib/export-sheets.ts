import "server-only";
import { type ExportStudentRow, formatPhone, RELATIONSHIP_LABELS, SEX_LABELS } from "@escolar/shared";
import type { CellValue, SheetColumn } from "./xlsx";

/** Columnas de la matrícula; las usa también la exportación de la departamental. */
export const STUDENT_COLUMNS: SheetColumn[] = [
  { header: "Identidad", width: 16 },
  { header: "Apellidos", width: 22 },
  { header: "Nombres", width: 22 },
  { header: "Nacimiento", type: "date", width: 12 },
  { header: "Sexo", width: 11 },
  { header: "Grado", width: 16 },
  { header: "Sección", width: 9 },
  { header: "Matrícula", width: 14 },
  { header: "Matriculado el", type: "date", width: 14 },
  { header: "Retirado el", type: "date", width: 12 },
  { header: "Responsable principal", width: 28 },
  { header: "Parentesco", width: 12 },
  { header: "Teléfono", width: 12 },
  { header: "Correo", width: 26 },
  { header: "Identidad del responsable", width: 16 },
];

export const studentCells = (s: ExportStudentRow): CellValue[] => [
  s.nationalId,
  s.lastNames,
  s.firstNames,
  s.birthDate,
  s.sex ? SEX_LABELS[s.sex] : null,
  s.gradeName,
  s.sectionName,
  s.status === "activa" ? "Activa" : s.status === "retirada" ? "Retirado" : "Sin matrícula",
  s.enrolledOn,
  s.withdrawnOn,
  s.guardianName,
  s.guardianRelationship ? RELATIONSHIP_LABELS[s.guardianRelationship] : null,
  s.guardianPhone ? formatPhone(s.guardianPhone) : null,
  s.guardianEmail,
  s.guardianNationalId,
];
