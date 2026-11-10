import "server-only";
import type {
  ActivityInput,
  AssignmentDto,
  AssignmentInput,
  AttendanceInput,
  AttendanceSheetDto,
  CoverageDto,
  CreatePlanInput,
  CreateStudentInput,
  GradebookDto,
  GradeDto,
  GradeInput,
  GradingPeriodDto,
  GuardianInput,
  ImportResultDto,
  LeaveDto,
  LeaveInput,
  LessonPlanDto,
  PeriodsInput,
  PlanBoardDto,
  PlanDetailDto,
  PlanTemplateDto,
  PlanTemplateInput,
  RegionalOverviewDto,
  RegionalSchoolDetailDto,
  ReviewPlanInput,
  SavePlanInput,
  SchoolFollowUpDto,
  SchoolYearDto,
  SchoolYearInput,
  ScoresInput,
  SectionDto,
  SectionInput,
  StudentDetailDto,
  StudentFields,
  StudentListItemDto,
  SubjectDto,
  SubstitutionInput,
  TeacherClassDto,
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

  // Cuaderno del maestro y seguimiento
  periods: (token: string) =>
    call<{ periods: GradingPeriodDto[]; current: string | null; passingGrade: number }>("/periods", {
      token,
    }),
  updatePeriods: (token: string, input: PeriodsInput) =>
    call<GradingPeriodDto[]>("/periods", { method: "PUT", token, body: input }),
  setPassingGrade: (token: string, passingGrade: number) =>
    call<{ passingGrade: number }>("/evaluation-settings", { method: "PUT", token, body: { passingGrade } }),
  teacherClasses: (token: string) => call<TeacherClassDto[]>("/teacher/classes", { token }),
  gradebook: (token: string, assignmentId: string, periodId?: string) =>
    call<GradebookDto>(`/gradebook/${assignmentId}${periodId ? `?periodId=${periodId}` : ""}`, { token }),
  putActivity: (token: string, input: ActivityInput) =>
    call<{ id: string }>(`/activities/${input.id}`, { method: "PUT", token, body: input }),
  deleteActivity: (token: string, id: string) => call<void>(`/activities/${id}`, { method: "DELETE", token }),
  putScores: (token: string, input: ScoresInput) =>
    call<{ saved: number }>("/scores", { method: "PUT", token, body: input }),
  attendance: (token: string, sectionId: string, fecha?: string) =>
    call<AttendanceSheetDto>(`/attendance/${sectionId}${fecha ? `?fecha=${fecha}` : ""}`, { token }),
  putAttendance: (token: string, input: AttendanceInput) =>
    call<{ saved: number }>("/attendance", { method: "PUT", token, body: input }),
  followUp: (token: string, fecha?: string) =>
    call<SchoolFollowUpDto>(fecha ? `/follow-up?fecha=${fecha}` : "/follow-up", { token }),
  gradesReport: (token: string, sectionId: string, periodId?: string) =>
    call<{
      section: SectionDto;
      period: GradingPeriodDto;
      passingGrade: number;
      subjects: Array<{ assignmentId: string; subjectName: string; teacherName: string }>;
      students: Array<{
        studentId: string;
        name: string;
        nationalId: string | null;
        grades: Record<string, { grade: number | null; points: number; possible: number }>;
      }>;
    }>(`/sections/${sectionId}/grades-report${periodId ? `?periodId=${periodId}` : ""}`, { token }),

  // Planificación semanal
  planTemplate: (token: string) => call<PlanTemplateDto>("/plan-template", { token }),
  updatePlanTemplate: (token: string, input: PlanTemplateInput) =>
    call<PlanTemplateDto>("/plan-template", { method: "PUT", token, body: input }),
  myPlans: (token: string, semana?: string) =>
    call<PlanBoardDto>(semana ? `/plans/mine?semana=${semana}` : "/plans/mine", { token }),
  planBoard: (token: string, semana?: string) =>
    call<PlanBoardDto>(semana ? `/plans/board?semana=${semana}` : "/plans/board", { token }),
  recentPlans: (token: string) => call<LessonPlanDto[]>("/plans/recent", { token }),
  createPlan: (token: string, input: CreatePlanInput) =>
    call<PlanDetailDto>("/plans", { method: "POST", token, body: input }),
  getPlan: (token: string, id: string) => call<PlanDetailDto>(`/plans/${id}`, { token }),
  savePlan: (token: string, id: string, input: SavePlanInput) =>
    call<PlanDetailDto>(`/plans/${id}`, { method: "PUT", token, body: input }),
  submitPlan: (token: string, id: string, input: Partial<SavePlanInput>) =>
    call<PlanDetailDto>(`/plans/${id}/submit`, { method: "POST", token, body: input }),
  reviewPlan: (token: string, id: string, input: ReviewPlanInput) =>
    call<PlanDetailDto>(`/plans/${id}/review`, { method: "POST", token, body: input }),

  importStudents: (token: string, rows: Record<string, string>[], dryRun: boolean) =>
    call<ImportResultDto>("/students/import", { method: "POST", token, body: { rows, dryRun } }),
};
