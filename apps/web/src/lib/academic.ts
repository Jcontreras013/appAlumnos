import "server-only";
import type {
  AssignmentDto,
  AssignmentInput,
  CoverageDto,
  CreateStudentInput,
  GradeDto,
  GradeInput,
  GuardianInput,
  ImportResultDto,
  LeaveDto,
  LeaveInput,
  RegionalOverviewDto,
  RegionalSchoolDetailDto,
  SchoolYearDto,
  SchoolYearInput,
  SectionDto,
  SectionInput,
  StudentDetailDto,
  StudentFields,
  StudentListItemDto,
  SubjectDto,
  SubstitutionInput,
} from "@escolar/shared";
import { serviceCall } from "./api";
import { academicUrl } from "./config";

const call = <T>(path: string, init?: Parameters<typeof serviceCall>[2]) =>
  serviceCall<T>(academicUrl(), path, init);

export interface StudentFilters {
  q?: string;
  sectionId?: string;
  estado?: "todos" | "matriculados" | "sin_matricula" | "retirados";
  limit?: number;
  offset?: number;
}

export const academic = {
  listYears: (token: string) => call<SchoolYearDto[]>("/school-years", { token }),
  createYear: (token: string, input: SchoolYearInput) =>
    call<SchoolYearDto>("/school-years", { method: "POST", token, body: input }),
  setCurrentYear: (token: string, id: string) =>
    call<SchoolYearDto>(`/school-years/${id}/current`, { method: "POST", token }),

  listGrades: (token: string) => call<GradeDto[]>("/grades", { token }),
  createGrade: (token: string, input: GradeInput) =>
    call<GradeDto>("/grades", { method: "POST", token, body: input }),

  listSections: (token: string, schoolYearId?: string) =>
    call<SectionDto[]>(schoolYearId ? `/sections?schoolYearId=${schoolYearId}` : "/sections", { token }),
  createSection: (token: string, input: SectionInput) =>
    call<SectionDto>("/sections", { method: "POST", token, body: input }),

  listSubjects: (token: string) => call<SubjectDto[]>("/subjects", { token }),
  createSubject: (token: string, name: string) =>
    call<SubjectDto>("/subjects", { method: "POST", token, body: { name } }),

  listAssignments: (token: string) => call<AssignmentDto[]>("/assignments", { token }),
  createAssignment: (token: string, input: AssignmentInput) =>
    call<AssignmentDto>("/assignments", { method: "POST", token, body: input }),
  deleteAssignment: (token: string, id: string) =>
    call<void>(`/assignments/${id}`, { method: "DELETE", token }),

  listStudents: (token: string, filters: StudentFilters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
    return call<{ items: StudentListItemDto[]; total: number }>(`/students?${params}`, { token });
  },
  getStudent: (token: string, id: string) => call<StudentDetailDto>(`/students/${id}`, { token }),
  createStudent: (token: string, input: CreateStudentInput) =>
    call<StudentDetailDto>("/students", { method: "POST", token, body: input }),
  updateStudent: (token: string, id: string, input: StudentFields) =>
    call<StudentDetailDto>(`/students/${id}`, { method: "PUT", token, body: input }),
  addGuardian: (token: string, id: string, input: GuardianInput) =>
    call<StudentDetailDto>(`/students/${id}/guardians`, { method: "POST", token, body: input }),
  setPrimaryGuardian: (token: string, id: string, guardianId: string) =>
    call<StudentDetailDto>(`/students/${id}/guardians/${guardianId}/primary`, { method: "POST", token }),
  removeGuardian: (token: string, id: string, guardianId: string) =>
    call<StudentDetailDto>(`/students/${id}/guardians/${guardianId}`, { method: "DELETE", token }),

  enroll: (token: string, studentId: string, sectionId: string) =>
    call<StudentDetailDto>("/enrollments", { method: "POST", token, body: { studentId, sectionId } }),
  withdraw: (token: string, enrollmentId: string, withdrawnOn: string, reason: string) =>
    call<StudentDetailDto>(`/enrollments/${enrollmentId}/withdraw`, {
      method: "POST",
      token,
      body: { withdrawnOn, reason },
    }),
  transfer: (token: string, enrollmentId: string, sectionId: string) =>
    call<StudentDetailDto>(`/enrollments/${enrollmentId}/transfer`, {
      method: "POST",
      token,
      body: { sectionId },
    }),

  // Licencias y sustituciones
  listLeaves: (token: string, estado: "actuales" | "pasadas" | "canceladas" = "actuales") =>
    call<LeaveDto[]>(`/leaves?estado=${estado}`, { token }),
  createLeave: (token: string, input: LeaveInput) =>
    call<LeaveDto>("/leaves", { method: "POST", token, body: input }),
  cancelLeave: (token: string, id: string) =>
    call<LeaveDto>(`/leaves/${id}/cancel`, { method: "POST", token }),
  addSubstitution: (token: string, leaveId: string, input: SubstitutionInput) =>
    call<LeaveDto>(`/leaves/${leaveId}/substitutions`, { method: "POST", token, body: input }),
  cancelSubstitution: (token: string, id: string) =>
    call<LeaveDto>(`/substitutions/${id}/cancel`, { method: "POST", token }),
  coverage: (token: string, fecha?: string) =>
    call<CoverageDto>(fecha ? `/coverage?fecha=${fecha}` : "/coverage", { token }),

  // Tablero departamental / distrital
  regionalOverview: (token: string, fecha?: string) =>
    call<RegionalOverviewDto>(fecha ? `/regional/overview?fecha=${fecha}` : "/regional/overview", { token }),
  regionalSchool: (token: string, id: string, fecha?: string) =>
    call<RegionalSchoolDetailDto>(`/regional/schools/${id}${fecha ? `?fecha=${fecha}` : ""}`, { token }),

  importStudents: (token: string, rows: Record<string, string>[], dryRun: boolean) =>
    call<ImportResultDto>("/students/import", { method: "POST", token, body: { rows, dryRun } }),
};
