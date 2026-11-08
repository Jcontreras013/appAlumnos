import { ApiError, parseOrThrow, requireRole, tenantOf } from "@escolar/service-kit";
import {
  type GuardianInput,
  guardianInputSchema,
  type IMPORT_COLUMNS,
  type ImportResultDto,
  type ImportRowResultDto,
  importInputSchema,
  normalizeHeader,
  parseFlexibleDate,
  type Relationship,
  type SectionDto,
  type StudentFields,
  studentFieldsSchema,
} from "@escolar/shared";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodError } from "zod";
import { guardians, studentGuardians, students } from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { enrollStudent } from "../lib/enroll";
import { listSections, requireCurrentYear } from "../lib/queries";
import { findOrCreateGuardian, insertStudent } from "../lib/students";

const FIELD_LABELS: Record<string, string> = {
  firstNames: "Nombres",
  lastNames: "Apellidos",
  nationalId: "Identidad",
  birthDate: "Fecha de nacimiento",
  sex: "Sexo",
  medicalNotes: "Alergias",
  fullName: "Responsable",
  phone: "Teléfono",
  email: "Correo",
};

const RELATIONSHIP_WORDS: Array<[Relationship, string[]]> = [
  ["madre", ["madre", "mama", "mamá"]],
  ["padre", ["padre", "papa", "papá"]],
  ["tutor", ["tutor", "tutora", "encargado", "encargada"]],
  ["abuelo", ["abuelo", "abuela"]],
];

function relationshipFrom(value: string): Relationship {
  const v = normalizeHeader(value);
  return RELATIONSHIP_WORDS.find(([, words]) => words.map(normalizeHeader).includes(v))?.[0] ?? "otro";
}

const describe = (error: ZodError, prefix = "") =>
  error.issues.map((i) => `${prefix}${FIELD_LABELS[String(i.path[0])] ?? String(i.path[0])}: ${i.message}`);

interface PlannedRow {
  student: StudentFields;
  guardian: GuardianInput;
  section: SectionDto;
}

/**
 * Importación de alumnos desde Excel/CSV (el frontend ya convirtió el archivo en filas).
 * - dryRun=true: valida todo y devuelve el resultado por fila, sin crear nada.
 * - dryRun=false: si no hay errores, crea todo en UNA transacción (o todo o nada).
 */
export async function importRoutes(app: FastifyInstance, { db, today }: AcademicDeps) {
  const write = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };

  app.post("/students/import", write, async (request): Promise<ImportResultDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(importInputSchema, request.body);
    const year = await requireCurrentYear(db, schoolId);
    const sectionList = await listSections(db, schoolId, year.id);
    const sectionsByKey = new Map(
      sectionList.map((s) => [`${normalizeHeader(s.gradeName)}|${normalizeHeader(s.name)}`, s]),
    );

    const existingStudentIds = new Set(
      (
        await db
          .select({ nationalId: students.nationalId })
          .from(students)
          .where(and(eq(students.schoolId, schoolId), isNotNull(students.nationalId)))
      ).map((r) => r.nationalId),
    );
    const existingGuardianIds = new Set(
      (
        await db
          .select({ nationalId: guardians.nationalId })
          .from(guardians)
          .where(and(eq(guardians.schoolId, schoolId), isNotNull(guardians.nationalId)))
      ).map((r) => r.nationalId),
    );

    const rows: ImportRowResultDto[] = [];
    const planned: PlannedRow[] = [];
    const studentIdsInFile = new Map<string, number>();
    const guardianKeysInFile = new Set<string>();
    const newPerSection = new Map<string, number>();
    let guardiansReused = 0;

    input.rows.forEach((raw, index) => {
      const rowNumber = index + 2; // la fila 1 del archivo son los encabezados
      const get = (key: (typeof IMPORT_COLUMNS)[number]["key"]) => (raw[key] ?? "").trim();
      const errors: string[] = [];

      const birthRaw = get("fecha_nacimiento");
      const birthDate = birthRaw ? parseFlexibleDate(birthRaw) : null;
      if (birthRaw && !birthDate)
        errors.push(`Fecha de nacimiento no válida: "${birthRaw}" (usa día/mes/año)`);
      const sexRaw = normalizeHeader(get("sexo"));
      const sex = sexRaw.startsWith("f") ? "F" : sexRaw.startsWith("m") ? "M" : undefined;
      if (sexRaw && !sex) errors.push(`Sexo no válido: "${get("sexo")}" (usa F o M)`);

      const student = studentFieldsSchema.safeParse({
        firstNames: get("nombres"),
        lastNames: get("apellidos"),
        nationalId: get("identidad"),
        birthDate: birthDate ?? "",
        sex: sex ?? "",
        medicalNotes: get("alergias"),
      });
      if (!student.success) errors.push(...describe(student.error));
      const nationalId = student.success ? student.data.nationalId : undefined;
      if (nationalId && existingStudentIds.has(nationalId)) {
        errors.push("Ya existe un alumno con esta identidad");
      } else if (nationalId && studentIdsInFile.has(nationalId)) {
        errors.push(`La identidad se repite en la fila ${studentIdsInFile.get(nationalId)}`);
      }
      if (nationalId) studentIdsInFile.set(nationalId, rowNumber);

      const guardian = guardianInputSchema.safeParse({
        fullName: get("responsable"),
        nationalId: get("identidad_responsable"),
        phone: get("telefono"),
        email: get("correo"),
        relationship: relationshipFrom(get("parentesco")),
        isPrimary: true,
      });
      if (!guardian.success) errors.push(...describe(guardian.error, "Responsable → "));

      const sectionText = `${get("grado")} ${get("seccion")}`.trim();
      const section = sectionsByKey.get(
        `${normalizeHeader(get("grado"))}|${normalizeHeader(get("seccion"))}`,
      );
      if (!section) errors.push(`No existe la sección "${sectionText}" en el año ${year.name}`);

      if (section && errors.length === 0) {
        const added = (newPerSection.get(section.id) ?? 0) + 1;
        if (section.capacity !== null && section.enrolledCount + added > section.capacity) {
          errors.push(`${section.label} se pasaría de su cupo de ${section.capacity} alumnos`);
        } else {
          newPerSection.set(section.id, added);
        }
      }

      if (errors.length === 0 && student.success && guardian.success && section) {
        const g = guardian.data;
        const key = g.nationalId ?? `${normalizeHeader(g.fullName)}|${g.phone ?? g.email}`;
        if ((g.nationalId && existingGuardianIds.has(g.nationalId)) || guardianKeysInFile.has(key)) {
          guardiansReused++;
        }
        guardianKeysInFile.add(key);
        planned.push({ student: student.data, guardian: g, section });
      }

      rows.push({
        row: rowNumber,
        student: `${get("nombres")} ${get("apellidos")}`.trim() || "(sin nombre)",
        section: section?.label ?? (sectionText || null),
        errors,
      });
    });

    const result: ImportResultDto = {
      dryRun: input.dryRun,
      total: rows.length,
      valid: planned.length,
      created: 0,
      guardiansReused,
      rows,
    };
    if (input.dryRun) return result;
    if (planned.length !== rows.length) {
      throw new ApiError(
        409,
        "import_has_errors",
        "El archivo tiene errores: revisa la vista previa",
        result,
      );
    }

    await db.transaction(async (tx) => {
      // Hermanos sin identidad del responsable: se agrupan por nombre + contacto dentro del archivo.
      const guardianByKey = new Map<string, string>();
      for (const row of planned) {
        const created = await insertStudent(tx, schoolId, row.student);
        const key = row.guardian.nationalId
          ? undefined
          : `${normalizeHeader(row.guardian.fullName)}|${row.guardian.phone ?? row.guardian.email}`;
        let guardianId = key ? guardianByKey.get(key) : undefined;
        if (!guardianId) {
          guardianId = (await findOrCreateGuardian(tx, schoolId, row.guardian)).guardian.id;
          if (key) guardianByKey.set(key, guardianId);
        }
        await tx.insert(studentGuardians).values({
          schoolId,
          studentId: created.id,
          guardianId,
          relationship: row.guardian.relationship,
          isPrimary: true,
        });
        // enrollStudent bloquea la sección y vuelve a verificar el cupo con datos reales
        await enrollStudent(tx, {
          schoolId,
          studentId: created.id,
          sectionId: row.section.id,
          today: today(),
        });
      }
      await audit(tx, request, {
        action: "students.imported",
        entityType: "import",
        data: { count: planned.length, schoolYear: year.name },
      });
    });

    return { ...result, created: planned.length };
  });
}
