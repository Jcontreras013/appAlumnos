import "server-only";
import type {
  ActivityInput,
  AnnouncementDto,
  AnnouncementInput,
  AssignmentDto,
  AssignmentInput,
  AttendanceInput,
  AttendanceSheetDto,
  AuditEventDto,
  BalanceRowDto,
  ChangeRequestDto,
  ChangeRequestKind,
  ClassChatDto,
  ClassChatMessageDto,
  ClassChatSummaryDto,
  ClassLinkInput,
  ClassMaterialDto,
  ClassPostDto,
  ClassPostInput,
  ClassQuizDetailDto,
  ClassQuizDto,
  ClassQuizInput,
  ClassroomDto,
  ClassSettingsInput,
  ClassSummaryDto,
  ClassTaskDetailDto,
  ClassTaskDto,
  ClassTaskInput,
  ConductActaDto,
  ConductIncidentDto,
  ConductOverviewDto,
  ConductStudentOptionDto,
  CoverageDto,
  CreateDocumentInput,
  CreatePlanInput,
  CreateStudentInput,
  DayOffDto,
  DayOffInput,
  DocumentDto,
  DocumentSummaryDto,
  EnrollmentSettingsDto,
  FamilyChildDto,
  FamilyChildSummaryDto,
  FeeDto,
  FeeRequest,
  FollowUpDto,
  FollowUpInput,
  GradebookDto,
  GradeDto,
  GradeInput,
  GradingPeriodDto,
  GuardianInput,
  GuardianUpdate,
  ImportResultDto,
  IncidentInput,
  LeaveDto,
  LeaveInput,
  LessonPlanDto,
  LibraryItemDto,
  LibraryLinkInput,
  MeasureInput,
  OfficePaymentInput,
  PaymentDto,
  PaymentSettingsDto,
  PaymentSettingsInput,
  PeriodsInput,
  PilotIndicatorsDto,
  PlanAssistantStatusDto,
  PlanBoardDto,
  PlanDetailDto,
  PlanDraftDto,
  PlanDraftInput,
  PlanTemplateDto,
  PlanTemplateInput,
  PortalAccessDto,
  PortalAccessInput,
  PromotionInput,
  PromotionSummaryDto,
  QuizAnswersInput,
  QuizAttemptDto,
  QuizQuestionDto,
  QuizQuestionInput,
  RecoveriesInput,
  RegionalExportDto,
  RegionalOverviewDto,
  RegionalSchoolDetailDto,
  RegionalStudentDto,
  ReviewPlanInput,
  SaveDocumentInput,
  SavePlanInput,
  ScheduleBlockDto,
  ScheduleBlocksInput,
  ScheduleDto,
  SchoolCalendarDto,
  SchoolExportDto,
  SchoolFollowUpDto,
  SchoolYearDto,
  SchoolYearInput,
  ScoresInput,
  SectionDto,
  SectionFamilyAccessDto,
  SectionFinalsDto,
  SectionInput,
  SectionScheduleInput,
  SectionStudentAccessDto,
  SectionUpdate,
  ShiftDto,
  ShiftInput,
  StudentAccessDto,
  StudentAccountDto,
  StudentDetailDto,
  StudentFields,
  StudentListItemDto,
  SubjectDto,
  SubjectInput,
  SubstitutionInput,
  TaskGradeInput,
  TaskSubmissionDto,
  TaskSubmissionInput,
  TeacherClassDto,
  TeacherTodayDto,
  TransferDto,
  TransferInput,
} from "@escolar/shared";
import { serviceCall } from "./api";
import { academicUrl } from "./config";

const call = <T>(path: string, init?: Parameters<typeof serviceCall>[2]) =>
  serviceCall<T>(academicUrl(), path, init);

export interface StudentFilters {
  q?: string;
  sectionId?: string;
  /** Una jornada, o "regular" (las secciones sin jornada). */
  shiftId?: string;
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
  updateGrade: (token: string, id: string, input: GradeInput) =>
    call<GradeDto>(`/grades/${id}`, { method: "PUT", token, body: input }),
  deleteGrade: (token: string, id: string) => call<void>(`/grades/${id}`, { method: "DELETE", token }),

  listSections: (token: string, schoolYearId?: string) =>
    call<SectionDto[]>(schoolYearId ? `/sections?schoolYearId=${schoolYearId}` : "/sections", { token }),
  createSection: (token: string, input: SectionInput) =>
    call<SectionDto>("/sections", { method: "POST", token, body: input }),
  updateSection: (token: string, id: string, input: SectionUpdate) =>
    call<SectionDto>(`/sections/${id}`, { method: "PUT", token, body: input }),
  deleteSection: (token: string, id: string) => call<void>(`/sections/${id}`, { method: "DELETE", token }),

  listShifts: (token: string) => call<ShiftDto[]>("/shifts", { token }),
  createShift: (token: string, input: ShiftInput) =>
    call<ShiftDto>("/shifts", { method: "POST", token, body: input }),
  updateShift: (token: string, id: string, input: ShiftInput) =>
    call<ShiftDto>(`/shifts/${id}`, { method: "PUT", token, body: input }),
  deleteShift: (token: string, id: string) => call<void>(`/shifts/${id}`, { method: "DELETE", token }),

  listSubjects: (token: string) => call<SubjectDto[]>("/subjects", { token }),
  createSubject: (token: string, input: SubjectInput) =>
    call<SubjectDto>("/subjects", { method: "POST", token, body: input }),
  updateSubject: (token: string, id: string, input: SubjectInput) =>
    call<SubjectDto>(`/subjects/${id}`, { method: "PUT", token, body: input }),
  deleteSubject: (token: string, id: string) => call<void>(`/subjects/${id}`, { method: "DELETE", token }),

  listAssignments: (token: string) => call<AssignmentDto[]>("/assignments", { token }),
  createAssignment: (token: string, input: AssignmentInput) =>
    call<AssignmentDto>("/assignments", { method: "POST", token, body: input }),
  changeAssignmentTeacher: (token: string, id: string, teacherUserId: string) =>
    call<AssignmentDto>(`/assignments/${id}`, { method: "PUT", token, body: { teacherUserId } }),
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
  updateGuardian: (token: string, id: string, guardianId: string, input: GuardianUpdate) =>
    call<StudentDetailDto>(`/students/${id}/guardians/${guardianId}`, { method: "PUT", token, body: input }),
  /** Tras corregir el nombre de alguien en identity: actualiza la copia en sus clases y licencias. */
  refreshPersonName: (token: string, userId: string) =>
    call<{ name: string }>(`/people/${userId}/refresh-name`, { method: "POST", token }),
  /** Lo mismo cuando corrige la departamental o la distrital: en todos los centros de esa persona. */
  refreshPersonNameInScope: (token: string, userId: string) =>
    call<{ name: string }>(`/regional/people/${userId}/refresh-name`, { method: "POST", token }),
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
  regionalStudent: (token: string, schoolId: string, studentId: string, fecha?: string) =>
    call<RegionalStudentDto>(
      `/regional/schools/${schoolId}/students/${studentId}${fecha ? `?fecha=${fecha}` : ""}`,
      { token },
    ),

  // Cuaderno del maestro y seguimiento
  periods: (token: string) =>
    call<{ periods: GradingPeriodDto[]; current: string | null; passingGrade: number }>("/periods", {
      token,
    }),
  updatePeriods: (token: string, input: PeriodsInput) =>
    call<GradingPeriodDto[]>("/periods", { method: "PUT", token, body: input }),
  enrollmentSettings: (token: string) => call<EnrollmentSettingsDto>("/enrollment-settings", { token }),
  setTeachersEnroll: (token: string, teachersEnroll: boolean) =>
    call<EnrollmentSettingsDto>("/enrollment-settings", { method: "PUT", token, body: { teachersEnroll } }),
  setPassingGrade: (token: string, passingGrade: number) =>
    call<{ passingGrade: number }>("/evaluation-settings", { method: "PUT", token, body: { passingGrade } }),
  teacherClasses: (token: string) => call<TeacherClassDto[]>("/teacher/classes", { token }),
  /** El día del maestro: clases de hoy, asistencia que falta y tareas por calificar. */
  teacherToday: (token: string) => call<TeacherTodayDto>("/teacher/today", { token }),
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
  pilotIndicators: (token: string, from?: string, to?: string) => {
    const query = new URLSearchParams({ ...(from ? { desde: from } : {}), ...(to ? { hasta: to } : {}) });
    return call<PilotIndicatorsDto>(`/regional/pilot${query.size ? `?${query}` : ""}`, { token });
  },
  listFollowUps: (token: string, studentId: string) =>
    call<FollowUpDto[]>(`/students/${studentId}/follow-ups`, { token }),
  addFollowUp: (token: string, studentId: string, input: FollowUpInput) =>
    call<FollowUpDto>(`/students/${studentId}/follow-ups`, { method: "POST", token, body: input }),
  deleteFollowUp: (token: string, id: string) => call<void>(`/follow-ups/${id}`, { method: "DELETE", token }),

  // Conducta
  conduct: (token: string) => call<ConductOverviewDto>("/conduct", { token }),
  conductStudents: (token: string) => call<ConductStudentOptionDto[]>("/conduct/students", { token }),
  studentConduct: (token: string, studentId: string) =>
    call<ConductIncidentDto[]>(`/students/${studentId}/conduct`, { token }),
  reportIncident: (token: string, input: IncidentInput) =>
    call<ConductIncidentDto>("/conduct/incidents", { method: "POST", token, body: input }),
  deleteIncident: (token: string, id: string) =>
    call<void>(`/conduct/incidents/${id}`, { method: "DELETE", token }),
  addMeasure: (token: string, incidentId: string, input: MeasureInput) =>
    call<ConductIncidentDto>(`/conduct/incidents/${incidentId}/measures`, {
      method: "POST",
      token,
      body: input,
    }),
  cancelMeasure: (token: string, measureId: string) =>
    call<ConductIncidentDto>(`/conduct/measures/${measureId}/cancel`, { method: "POST", token }),
  conductActa: (token: string, measureId: string) =>
    call<ConductActaDto>(`/conduct/measures/${measureId}/acta`, { token }),
  announcements: (token: string) => call<AnnouncementDto[]>("/announcements", { token }),
  familyAnnouncements: (token: string) => call<AnnouncementDto[]>("/family/announcements", { token }),
  publishAnnouncement: (token: string, input: AnnouncementInput) =>
    call<AnnouncementDto>("/announcements", { method: "POST", token, body: input }),
  removeAnnouncement: (token: string, id: string) =>
    call<void>(`/announcements/${id}`, { method: "DELETE", token }),

  // Documentos del centro
  listDocuments: (token: string) => call<DocumentSummaryDto[]>("/documents", { token }),
  createDocument: (token: string, input: CreateDocumentInput) =>
    call<DocumentDto>("/documents", { method: "POST", token, body: input }),
  getDocument: (token: string, id: string) => call<DocumentDto>(`/documents/${id}`, { token }),
  saveDocument: (token: string, id: string, input: SaveDocumentInput) =>
    call<DocumentDto>(`/documents/${id}`, { method: "PUT", token, body: input }),
  deleteDocument: (token: string, id: string) => call<void>(`/documents/${id}`, { method: "DELETE", token }),

  // Biblioteca virtual (los archivos se suben por /api/biblioteca y se bajan por /panel/biblioteca/archivo)
  library: (token: string, filters: { grado?: string; materia?: string } = {}) => {
    const query = new URLSearchParams(filters);
    return call<LibraryItemDto[]>(`/library${query.size ? `?${query}` : ""}`, { token });
  },
  libraryItem: (token: string, id: string) => call<LibraryItemDto>(`/library/${id}`, { token }),
  addLibraryLink: (token: string, input: LibraryLinkInput) =>
    call<LibraryItemDto>("/library/links", { method: "POST", token, body: input }),
  removeLibraryItem: (token: string, id: string) => call<void>(`/library/${id}`, { method: "DELETE", token }),

  // Calendario escolar
  calendar: (token: string) => call<SchoolCalendarDto>("/calendar", { token }),
  addDayOff: (token: string, input: DayOffInput) =>
    call<DayOffDto>("/calendar/days-off", { method: "POST", token, body: input }),
  removeDayOff: (token: string, id: string) =>
    call<void>(`/calendar/days-off/${id}`, { method: "DELETE", token }),
  auditLog: (token: string, before?: string) =>
    call<AuditEventDto[]>(`/audit?limite=50${before ? `&antes=${encodeURIComponent(before)}` : ""}`, {
      token,
    }),
  saveScheduleBlocks: (token: string, input: ScheduleBlocksInput) =>
    call<ScheduleBlockDto[]>("/schedule/blocks", { method: "PUT", token, body: input }),
  sectionSchedule: (token: string, sectionId: string) =>
    call<ScheduleDto>(`/schedule/sections/${sectionId}`, { token }),
  saveSectionSchedule: (token: string, sectionId: string, input: SectionScheduleInput) =>
    call<ScheduleDto>(`/schedule/sections/${sectionId}`, { method: "PUT", token, body: input }),
  mySchedule: (token: string) => call<ScheduleDto>("/schedule/mine", { token }),
  childSchedule: (token: string, studentId: string) =>
    call<ScheduleDto>(`/family/children/${studentId}/schedule`, { token }),
  sendTransfer: (token: string, studentId: string, input: TransferInput) =>
    call<TransferDto>(`/students/${studentId}/transfers`, { method: "POST", token, body: input }),
  transfers: (token: string) =>
    call<{ incoming: TransferDto[]; outgoing: TransferDto[] }>("/transfers", { token }),
  receiveTransfer: (token: string, id: string, sectionId: string) =>
    call<TransferDto>(`/transfers/${id}/receive`, { method: "POST", token, body: { sectionId } }),
  cancelTransfer: (token: string, id: string) =>
    call<TransferDto>(`/transfers/${id}/cancel`, { method: "POST", token }),
  studentTransfers: (token: string, studentId: string) =>
    call<TransferDto[]>(`/students/${studentId}/transfers`, { token }),
  sectionFinals: (token: string, sectionId: string) =>
    call<SectionFinalsDto>(`/sections/${sectionId}/finals`, { token }),
  saveRecoveries: (token: string, assignmentId: string, input: RecoveriesInput) =>
    call<SectionFinalsDto>(`/assignments/${assignmentId}/recoveries`, { method: "PUT", token, body: input }),
  promote: (token: string, input: PromotionInput) =>
    call<PromotionSummaryDto>("/promotion", { method: "POST", token, body: input }),
  exportSchool: (token: string) => call<SchoolExportDto>("/export/school", { token }),
  exportRegion: (token: string) => call<RegionalExportDto>("/regional/export", { token }),
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

  // Portal de familias
  grantPortalAccess: (token: string, guardianId: string, input: PortalAccessInput) =>
    call<PortalAccessDto>(`/guardians/${guardianId}/portal-access`, { method: "POST", token, body: input }),
  resetPortalAccess: (token: string, guardianId: string) =>
    call<PortalAccessDto>(`/guardians/${guardianId}/portal-access/reset`, { method: "POST", token }),
  revokePortalAccess: (token: string, guardianId: string) =>
    call<void>(`/guardians/${guardianId}/portal-access`, { method: "DELETE", token }),
  // Aula virtual: la página de cada clase
  classes: (token: string, options: { alumno?: string; todas?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (options.alumno) query.set("alumno", options.alumno);
    if (options.todas) query.set("todas", "1");
    const qs = query.toString();
    return call<ClassSummaryDto[]>(`/classes${qs ? `?${qs}` : ""}`, { token });
  },
  classroom: (token: string, assignmentId: string) =>
    call<ClassroomDto>(`/classes/${assignmentId}`, { token }),
  saveClassSettings: (token: string, assignmentId: string, input: ClassSettingsInput) =>
    call<unknown>(`/classes/${assignmentId}/settings`, { method: "PUT", token, body: input }),
  createClassPost: (token: string, assignmentId: string, input: ClassPostInput) =>
    call<ClassPostDto>(`/classes/${assignmentId}/posts`, { method: "POST", token, body: input }),
  updateClassPost: (token: string, postId: string, input: ClassPostInput) =>
    call<ClassPostDto>(`/class-posts/${postId}`, { method: "PUT", token, body: input }),
  deleteClassPost: (token: string, postId: string) =>
    call<void>(`/class-posts/${postId}`, { method: "DELETE", token }),
  orderClassTopics: (token: string, assignmentId: string, ids: string[]) =>
    call<unknown>(`/classes/${assignmentId}/topics/order`, { method: "PUT", token, body: { ids } }),
  addClassLink: (token: string, postId: string, input: ClassLinkInput) =>
    call<ClassMaterialDto>(`/class-posts/${postId}/links`, { method: "POST", token, body: input }),
  deleteClassMaterial: (token: string, materialId: string) =>
    call<void>(`/class-materials/${materialId}`, { method: "DELETE", token }),

  // Aula virtual: tareas
  createClassTask: (token: string, assignmentId: string, input: ClassTaskInput) =>
    call<ClassTaskDto>(`/classes/${assignmentId}/tasks`, { method: "POST", token, body: input }),
  updateClassTask: (token: string, taskId: string, input: ClassTaskInput) =>
    call<ClassTaskDto>(`/class-tasks/${taskId}`, { method: "PUT", token, body: input }),
  deleteClassTask: (token: string, taskId: string) =>
    call<void>(`/class-tasks/${taskId}`, { method: "DELETE", token }),
  classTask: (token: string, taskId: string, alumno?: string) =>
    call<ClassTaskDetailDto>(`/class-tasks/${taskId}${alumno ? `?alumno=${alumno}` : ""}`, { token }),
  gradeTask: (token: string, taskId: string, studentId: string, input: TaskGradeInput) =>
    call<TaskSubmissionDto>(`/class-tasks/${taskId}/grades/${studentId}`, {
      method: "PUT",
      token,
      body: input,
    }),
  saveSubmission: (token: string, taskId: string, input: TaskSubmissionInput, alumno?: string) =>
    call<TaskSubmissionDto>(`/class-tasks/${taskId}/submission${alumno ? `?alumno=${alumno}` : ""}`, {
      method: "PUT",
      token,
      body: input,
    }),
  deleteTaskFile: (token: string, fileId: string) =>
    call<void>(`/task-files/${fileId}`, { method: "DELETE", token }),

  // Aula virtual: exámenes
  createQuiz: (token: string, assignmentId: string, input: ClassQuizInput) =>
    call<ClassQuizDto>(`/classes/${assignmentId}/quizzes`, { method: "POST", token, body: input }),
  updateQuiz: (token: string, quizId: string, input: ClassQuizInput) =>
    call<ClassQuizDto>(`/class-quizzes/${quizId}`, { method: "PUT", token, body: input }),
  deleteQuiz: (token: string, quizId: string) =>
    call<void>(`/class-quizzes/${quizId}`, { method: "DELETE", token }),
  publishQuiz: (token: string, quizId: string, published: boolean) =>
    call<ClassQuizDto>(`/class-quizzes/${quizId}/publish`, { method: "POST", token, body: { published } }),
  addQuizQuestion: (token: string, quizId: string, input: QuizQuestionInput) =>
    call<QuizQuestionDto>(`/class-quizzes/${quizId}/questions`, { method: "POST", token, body: input }),
  updateQuizQuestion: (token: string, questionId: string, input: QuizQuestionInput) =>
    call<QuizQuestionDto>(`/quiz-questions/${questionId}`, { method: "PUT", token, body: input }),
  deleteQuizQuestion: (token: string, questionId: string) =>
    call<void>(`/quiz-questions/${questionId}`, { method: "DELETE", token }),
  quiz: (token: string, quizId: string, alumno?: string) =>
    call<ClassQuizDetailDto>(`/class-quizzes/${quizId}${alumno ? `?alumno=${alumno}` : ""}`, { token }),
  startQuiz: (token: string, quizId: string, alumno?: string) =>
    call<{ started: boolean }>(`/class-quizzes/${quizId}/start${alumno ? `?alumno=${alumno}` : ""}`, {
      method: "POST",
      token,
    }),
  saveQuizAnswers: (token: string, quizId: string, input: QuizAnswersInput, alumno?: string) =>
    call<QuizAttemptDto>(`/class-quizzes/${quizId}/answers${alumno ? `?alumno=${alumno}` : ""}`, {
      method: "PUT",
      token,
      body: input,
    }),
  // Chat de la clase
  // Pagos de las familias
  fees: (token: string) => call<FeeDto[]>("/fees", { token }),
  createFee: (token: string, input: FeeRequest) =>
    call<{ id: string; students: number; scopeLabel: string }>("/fees", {
      method: "POST",
      token,
      body: input,
    }),
  cancelFee: (token: string, id: string) =>
    call<void>(`/fees/${id}/cancel`, { method: "POST", token, body: {} }),
  studentAccount: (token: string, studentId: string) =>
    call<StudentAccountDto>(`/students/${studentId}/account`, { token }),
  balances: (token: string, sectionId?: string) =>
    call<BalanceRowDto[]>(`/payments/balances${sectionId ? `?sectionId=${sectionId}` : ""}`, { token }),
  recentPayments: (token: string) => call<PaymentDto[]>("/payments", { token }),
  recordPayment: (token: string, input: OfficePaymentInput) =>
    call<PaymentDto>("/payments", { method: "POST", token, body: input }),
  payment: (token: string, id: string) => call<PaymentDto>(`/payments/${id}`, { token }),
  voidPayment: (token: string, id: string, reason: string) =>
    call<PaymentDto>(`/payments/${id}/void`, { method: "POST", token, body: { reason } }),
  childAccount: (token: string, studentId: string) =>
    call<StudentAccountDto>(`/family/children/${studentId}/account`, { token }),
  /** El alumno que responde por sí mismo: sus cobros (404 si sus pagos los ve su familia). */
  myAccount: (token: string) => call<StudentAccountDto>("/student/me/account", { token }),
  payMine: (token: string, input: { chargeIds: string[]; email: string; returnBase: string }) =>
    call<{ action: string; fields: Record<string, string>; orderId: string }>("/student/me/pay", {
      method: "POST",
      token,
      body: input,
    }),
  payOnline: (
    token: string,
    studentId: string,
    input: { chargeIds: string[]; email: string; returnBase: string },
  ) =>
    call<{ action: string; fields: Record<string, string>; orderId: string }>(
      `/family/children/${studentId}/pay`,
      {
        method: "POST",
        token,
        body: input,
      },
    ),
  completeOnline: (token: string, input: { orderId: string; paymentHash?: string; cancelled?: boolean }) =>
    call<{ status: string; paymentId: string; studentId: string }>("/payments/online/complete", {
      method: "POST",
      token,
      body: input,
    }),
  /** Regreso desde PixelPay a la página pública: sin sesión, se confirma con el paymentHash. */
  returnOnline: (schoolId: string, input: { orderId: string; paymentHash?: string; cancelled?: boolean }) =>
    call<{
      status: "confirmado" | "cancelado" | "pendiente";
      paymentId: string;
      receiptNumber: number | null;
      amountCents: number;
      duplicate: boolean;
    }>(`/payments/online/return/${schoolId}`, { method: "POST", body: input }),
  /** Aviso de PixelPay: llega sin sesión; lo valida academic con el hash de la llave secreta. */
  pixelpayCallback: (schoolId: string, body: unknown) =>
    call<{ ok: boolean }>(`/payments/pixelpay/callback/${schoolId}`, { method: "POST", body }),
  paymentSettings: (token: string) => call<PaymentSettingsDto>("/payment-settings", { token }),
  savePaymentSettings: (token: string, input: PaymentSettingsInput) =>
    call<PaymentSettingsDto>("/payment-settings", { method: "PUT", token, body: input }),
  // Solicitudes de la secretaría que confirma la dirección
  createChangeRequest: (token: string, kind: ChangeRequestKind, payload: Record<string, unknown>) =>
    call<ChangeRequestDto>("/change-requests", { method: "POST", token, body: { kind, payload } }),
  changeRequests: (token: string, estado: "pendiente" | "todas" = "todas") =>
    call<ChangeRequestDto[]>(`/change-requests?estado=${estado}`, { token }),
  pendingChangeRequests: (token: string) =>
    call<{ count: number }>("/change-requests/pending-count", { token }),
  approveChangeRequest: (token: string, id: string) =>
    call<ChangeRequestDto>(`/change-requests/${id}/approve`, { method: "POST", token, body: {} }),
  rejectChangeRequest: (token: string, id: string, note?: string) =>
    call<ChangeRequestDto>(`/change-requests/${id}/reject`, { method: "POST", token, body: { note } }),
  classChats: (token: string) => call<ClassChatSummaryDto[]>("/class-chats", { token }),
  classChat: (token: string, assignmentId: string) =>
    call<ClassChatDto>(`/classes/${assignmentId}/chat`, { token }),
  sendClassChat: (token: string, assignmentId: string, body: string) =>
    call<ClassChatMessageDto>(`/classes/${assignmentId}/chat`, { method: "POST", token, body: { body } }),
  deleteClassChat: (token: string, messageId: string) =>
    call<void>(`/class-chat/${messageId}`, { method: "DELETE", token }),
  setClassChat: (token: string, assignmentId: string, enabled: boolean) =>
    call<{ enabled: boolean }>(`/classes/${assignmentId}/chat/estado`, {
      method: "PUT",
      token,
      body: { enabled },
    }),

  reviewQuiz: (
    token: string,
    quizId: string,
    studentId: string,
    review: { points: Record<string, number>; comments: Record<string, string>; feedback: string },
  ) =>
    call<QuizAttemptDto>(`/class-quizzes/${quizId}/attempts/${studentId}/review`, {
      method: "PUT",
      token,
      body: review,
    }),

  // Cuentas de los alumnos (aula virtual)
  grantStudentAccess: (token: string, studentId: string, input: PortalAccessInput) =>
    call<StudentAccessDto>(`/students/${studentId}/student-access`, { method: "POST", token, body: input }),
  resetStudentAccess: (token: string, studentId: string) =>
    call<StudentAccessDto>(`/students/${studentId}/student-access/reset`, { method: "POST", token }),
  revokeStudentAccess: (token: string, studentId: string) =>
    call<void>(`/students/${studentId}/student-access`, { method: "DELETE", token }),
  sectionStudentAccess: (token: string, sectionId: string) =>
    call<SectionStudentAccessDto>(`/sections/${sectionId}/student-access`, { method: "POST", token }),
  sectionFamilyAccess: (token: string, sectionId: string, allGuardians: boolean) =>
    call<SectionFamilyAccessDto>(`/sections/${sectionId}/portal-access`, {
      method: "POST",
      token,
      body: { allGuardians },
    }),
  studentMe: (token: string) => call<FamilyChildDto>("/student/me", { token }),
  studentSchedule: (token: string) => call<ScheduleDto>("/student/me/schedule", { token }),
  reportCard: (token: string, studentId: string) =>
    call<FamilyChildDto>(`/students/${studentId}/report-card`, { token }),
  familyChildren: (token: string) => call<FamilyChildSummaryDto[]>("/family/children", { token }),
  familyChild: (token: string, studentId: string) =>
    call<FamilyChildDto>(`/family/children/${studentId}`, { token }),

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
  planAssistant: (token: string) => call<PlanAssistantStatusDto>("/plans/assistant", { token }),
  /** El borrador con IA tarda (normalmente 20-60 s): se espera hasta 2 minutos y medio. */
  draftPlan: (token: string, id: string, input: PlanDraftInput) =>
    call<PlanDraftDto>(`/plans/${id}/draft`, { method: "POST", token, body: input, timeoutMs: 150_000 }),
  savePlan: (token: string, id: string, input: SavePlanInput) =>
    call<PlanDetailDto>(`/plans/${id}`, { method: "PUT", token, body: input }),
  submitPlan: (token: string, id: string, input: Partial<SavePlanInput>) =>
    call<PlanDetailDto>(`/plans/${id}/submit`, { method: "POST", token, body: input }),
  reviewPlan: (token: string, id: string, input: ReviewPlanInput) =>
    call<PlanDetailDto>(`/plans/${id}/review`, { method: "POST", token, body: input }),

  importStudents: (token: string, rows: Record<string, string>[], dryRun: boolean) =>
    call<ImportResultDto>("/students/import", { method: "POST", token, body: { rows, dryRun } }),
};
