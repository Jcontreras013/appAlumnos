import { z } from "zod";
import { LIBRARY_FILE_TYPES } from "./library";

/*
 * Aula virtual: cada clase (una materia en una sección, con su maestro) tiene su página, como en
 * Canvas o Classroom. El maestro publica temas con su explicación y materiales (archivos, enlaces,
 * videos de YouTube), avisos de la clase y el enlace de la clase en línea (Meet, Zoom o Jitsi). Los
 * alumnos y sus familias la ven; la dirección y la coordinación también.
 */

export const CLASS_POST_KINDS = ["tema", "aviso"] as const;
export type ClassPostKind = (typeof CLASS_POST_KINDS)[number];
export const CLASS_POST_LABELS: Record<ClassPostKind, string> = { tema: "Tema", aviso: "Aviso" };

export const CLASS_MATERIAL_KINDS = ["archivo", "enlace", "video"] as const;
export type ClassMaterialKind = (typeof CLASS_MATERIAL_KINDS)[number];

const MB = 1024 * 1024;

/** Lo que el maestro sube a un tema: documentos de Office, PDF e imágenes (fotos de la pizarra). */
export const CLASS_FILE_TYPES: Record<string, { ext: string; label: string }> = {
  ...LIBRARY_FILE_TYPES,
  "image/jpeg": { ext: "jpg", label: "Imagen" },
  "image/png": { ext: "png", label: "Imagen" },
  "image/webp": { ext: "webp", label: "Imagen" },
};
/** Los videos van por YouTube (como «no listado»): guardarlos y transmitirlos aquí cuesta mucho. */
export const CLASS_FILE_MAX_BYTES = 30 * MB;

/** El tipo de un archivo por lo que dice el navegador o, si no lo dice, por su extensión. */
export function classFileTypeOf(fileName: string, declared?: string): string | null {
  if (declared && Object.hasOwn(CLASS_FILE_TYPES, declared)) return declared;
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpeg") return "image/jpeg";
  const found = Object.entries(CLASS_FILE_TYPES).find(([, t]) => t.ext === ext);
  return found ? found[0] : null;
}

/** El id de un video de YouTube (youtu.be/…, watch?v=…, shorts/…, embed/…); null si no es de YouTube. */
export function youtubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www\.|m\.)/, "");
  const valid = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);
  if (host === "youtu.be") return valid(parsed.pathname.slice(1).split("/")[0]);
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (parsed.pathname === "/watch") return valid(parsed.searchParams.get("v"));
    const [, kind, id] = parsed.pathname.split("/");
    if (kind === "shorts" || kind === "embed" || kind === "live") return valid(id);
  }
  return null;
}

const httpsUrl = (message: string) =>
  z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => {
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      },
      { error: message },
    );

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** Enlace de la clase en línea y cuándo es. Vacío = quitarlo. */
export const classSettingsInputSchema = z.object({
  meetingUrl: z.preprocess(
    blankToUndefined,
    httpsUrl("Pega el enlace de Meet, Zoom o Jitsi (empieza con https://)").optional(),
  ),
  meetingNote: optionalText(200),
});
export type ClassSettingsInput = z.infer<typeof classSettingsInputSchema>;

export const classPostInputSchema = z.object({
  kind: z.enum(CLASS_POST_KINDS, { error: "Elige si es un tema o un aviso" }),
  title: z
    .string({ error: "Escribe el título" })
    .trim()
    .min(2, { error: "Escribe el título" })
    .max(150, { error: "Máximo 150 caracteres" }),
  body: z.preprocess(
    (v) => (v === undefined || v === null ? "" : v),
    z.string().trim().max(8000, { error: "Máximo 8,000 caracteres" }),
  ),
});
export type ClassPostInput = z.infer<typeof classPostInputSchema>;

/** Un enlace o un video de YouTube en un tema (el tipo se decide por el enlace). */
export const classLinkInputSchema = z.object({
  title: optionalText(150),
  url: httpsUrl("Pega un enlace que empiece con https://"),
});
export type ClassLinkInput = z.infer<typeof classLinkInputSchema>;

/** Orden de los temas (de arriba abajo). */
export const classTopicOrderSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
});

// ───────────────────────────── DTOs ─────────────────────────────

/** Quién mira la clase: el que la da (o la dirección), la oficina, el alumno o su familia. */
export type ClassViewer = "docente" | "oficina" | "alumno" | "familia";

export interface ClassSummaryDto {
  assignmentId: string;
  subjectName: string;
  sectionId: string;
  sectionLabel: string;
  teacherName: string;
  meetingUrl: string | null;
  meetingNote: string | null;
  topics: number;
  /** El maestro la cubre como sustituto. */
  substituting: boolean;
}

export interface ClassMaterialDto {
  id: string;
  kind: ClassMaterialKind;
  title: string;
  url: string | null;
  /** Para mostrar el video dentro de la página. */
  youtubeId: string | null;
  file: { name: string; contentType: string; size: number } | null;
  createdAt: string;
}

export interface ClassPostDto {
  id: string;
  kind: ClassPostKind;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  materials: ClassMaterialDto[];
}

export interface ClassroomDto {
  assignmentId: string;
  subjectName: string;
  sectionId: string;
  sectionLabel: string;
  teacherName: string;
  meetingUrl: string | null;
  meetingNote: string | null;
  viewer: ClassViewer;
  /** Puede publicar y cambiar lo de la clase (el maestro o su sustituto, la dirección, la coordinación). */
  canEdit: boolean;
  /** En el orden que eligió el maestro. */
  topics: ClassPostDto[];
  /** Del más reciente al más viejo. */
  announcements: ClassPostDto[];
  /** De la más próxima a vencer a la más vieja. */
  tasks: ClassTaskDto[];
  /** Exámenes (el alumno solo ve los publicados). */
  quizzes: ClassQuizDto[];
  /** El maestro abrió el chat de la clase. */
  chatEnabled: boolean;
}

// ───────────────────────────── Chat de la clase ─────────────────────────────

export const CLASS_CHAT_MAX_LENGTH = 1000;

export const classChatInputSchema = z.object({
  body: z
    .string({ error: "Escribe un mensaje" })
    .trim()
    .min(1, { error: "Escribe un mensaje" })
    .max(CLASS_CHAT_MAX_LENGTH, { error: `Un mensaje lleva hasta ${CLASS_CHAT_MAX_LENGTH} caracteres` }),
});

export const classChatStatusSchema = z.object({ enabled: z.boolean() });

export interface ClassChatMessageDto {
  id: string;
  authorName: string;
  authorRole: "maestro" | "alumno";
  /** Lo escribió quien mira. */
  mine: boolean;
  /** null si se borró. */
  body: string | null;
  createdAt: string;
}

export interface ClassChatDto {
  /** Materia y sección (para el título de la página del chat). */
  subjectName: string;
  sectionLabel: string;
  teacherName: string | null;
  enabled: boolean;
  /** Puede escribir (el chat está abierto y es el maestro o un alumno de la sección). */
  canWrite: boolean;
  /** Puede borrar cualquier mensaje y abrir o cerrar el chat (el maestro, la dirección, la coordinación). */
  canModerate: boolean;
  /** Del más viejo al más nuevo. */
  messages: ClassChatMessageDto[];
}

/** Un chat de clase en la lista del apartado «Chats». */
export interface ClassChatSummaryDto {
  assignmentId: string;
  subjectName: string;
  sectionLabel: string;
  teacherName: string | null;
  enabled: boolean;
  /** El último mensaje (null si nadie ha escrito). El texto es null si se borró. */
  last: { authorName: string; body: string | null; createdAt: string } | null;
}

// ───────────────────────────── Tareas con entrega ─────────────────────────────

/** Lo que entrega el alumno: fotos del cuaderno, documentos o PDF. */
export const SUBMISSION_FILE_MAX_BYTES = 15 * MB;
export const SUBMISSION_FILES_MAX = 10;

/** Hora de Honduras (sin horario de verano): 2026-11-20 + 23:59 → instante. */
export function hondurasInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-06:00`);
}

/** Cuándo ven los alumnos una tarea: ya, nunca hasta que el maestro la publique, o en una fecha. */
export const TASK_PUBLISH_MODES = ["ahora", "borrador", "programar"] as const;
export type TaskPublishMode = (typeof TASK_PUBLISH_MODES)[number];
/** publicada: la ven los alumnos; programada: la verán en `publishAt`; borrador: solo el maestro. */
export type TaskVisibility = "publicada" | "programada" | "borrador";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Elige la fecha de entrega" });
const hhmm = z.preprocess(
  (v) => (v === undefined || v === null || v === "" ? "23:59" : v),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Hora inválida" }),
);
const optionalPoints = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
  z
    .number({ error: "Escribe un número" })
    .positive({ error: "Debe valer más de 0" })
    .max(100, { error: "Un parcial vale 100 puntos" })
    .optional(),
);

/**
 * Una tarea. Si vale puntos, va a la libreta como una actividad del parcial elegido (y cuenta dentro
 * de los 100 puntos del parcial); sin puntos, es solo para entregar.
 */
export const classTaskInputSchema = z
  .object({
    title: z
      .string({ error: "Escribe el título" })
      .trim()
      .min(2, { error: "Escribe el título" })
      .max(150, { error: "Máximo 150 caracteres" }),
    instructions: z.preprocess(
      (v) => (v === undefined || v === null ? "" : v),
      z.string().trim().max(8000, { error: "Máximo 8,000 caracteres" }),
    ),
    dueDate: isoDate,
    dueTime: hhmm,
    allowLate: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
    points: optionalPoints,
    periodId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.uuid().optional()),
    /** Publicarla ya, guardarla sin publicar o programar cuándo la ven los alumnos. */
    publish: z.preprocess(
      (v) => (v === undefined || v === null || v === "" ? "ahora" : v),
      z.enum(TASK_PUBLISH_MODES, { error: "Elige cuándo se publica" }),
    ),
    publishDate: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().optional()),
    publishTime: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().optional()),
  })
  .refine((v) => v.points === undefined || v.periodId, {
    error: "Elige en qué parcial cuenta",
    path: ["periodId"],
  })
  .refine((v) => v.publish !== "programar" || (v.publishDate && /^\d{4}-\d{2}-\d{2}$/.test(v.publishDate)), {
    error: "Elige la fecha de publicación",
    path: ["publishDate"],
  })
  .refine(
    (v) => v.publish !== "programar" || !v.publishTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(v.publishTime),
    {
      error: "Hora inválida",
      path: ["publishTime"],
    },
  )
  .refine(
    (v) =>
      v.publish !== "programar" ||
      !v.publishDate ||
      `${v.publishDate}T${v.publishTime ?? "07:00"}` <= `${v.dueDate}T${v.dueTime}`,
    { error: "Se publicaría después de la fecha de entrega", path: ["publishDate"] },
  );
export type ClassTaskInput = z.infer<typeof classTaskInputSchema>;

export const taskSubmissionInputSchema = z.object({
  text: z.preprocess(
    (v) => (v === undefined || v === null ? "" : v),
    z.string().trim().max(8000, { error: "Máximo 8,000 caracteres" }),
  ),
  /** true = entregar; false = guardar sin entregar (o anular la entrega para corregirla). */
  turnIn: z.boolean(),
});
export type TaskSubmissionInput = z.infer<typeof taskSubmissionInputSchema>;

export const taskGradeInputSchema = z.object({
  points: z.preprocess(
    (v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v),
    z.number({ error: "Escribe un número" }).min(0, { error: "No puede ser negativa" }).nullable(),
  ),
  feedback: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(2000, { error: "Máximo 2,000 caracteres" }).optional(),
  ),
});
export type TaskGradeInput = z.infer<typeof taskGradeInputSchema>;

export type TaskStatus = "pendiente" | "borrador" | "entregada" | "tarde" | "calificada" | "vencida";
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendiente: "Pendiente",
  borrador: "Sin entregar (guardada)",
  entregada: "Entregada",
  tarde: "Entregada tarde",
  calificada: "Calificada",
  vencida: "No entregó",
};

export interface TaskFileDto {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface ClassTaskDto {
  id: string;
  assignmentId: string;
  title: string;
  instructions: string;
  dueAt: string;
  /** Fecha y hora de entrega en Honduras, para los formularios. */
  dueDate: string;
  dueTime: string;
  allowLate: boolean;
  /** null: la tarea no lleva nota. */
  points: number | null;
  periodId: string | null;
  periodName: string | null;
  attachments: TaskFileDto[];
  createdAt: string;
  /** Cuándo la ven los alumnos (null: borrador). Fecha y hora en Honduras, para los formularios. */
  publishAt: string | null;
  publishDate: string | null;
  publishTime: string | null;
  visibility: TaskVisibility;
  /** Para quien da la clase: cuántos entregaron y cuántos ya tienen nota. */
  stats: { total: number; submitted: number; graded: number } | null;
  /** Para el alumno o su familia: cómo va su entrega. */
  status: TaskStatus | null;
  /** Para el alumno o su familia: su nota, si ya la tiene. */
  myPoints: number | null;
}

export interface TaskSubmissionDto {
  studentId: string;
  studentName: string;
  text: string;
  submittedAt: string | null;
  submittedByName: string | null;
  /** La entregó otra persona (su familia), no el alumno con su cuenta. */
  submittedByOther: boolean;
  late: boolean;
  points: number | null;
  feedback: string | null;
  gradedAt: string | null;
  files: TaskFileDto[];
  status: TaskStatus;
}

export interface ClassTaskDetailDto {
  task: ClassTaskDto;
  subjectName: string;
  sectionLabel: string;
  viewer: ClassViewer;
  canEdit: boolean;
  /** Para quien da la clase: un renglón por alumno de la sección. */
  submissions: TaskSubmissionDto[] | null;
  /** Para el alumno o su familia: su entrega (la del hijo elegido). */
  mine: TaskSubmissionDto | null;
  /** Para el alumno o su familia: todavía puede cambiar su entrega. */
  canSubmit: boolean;
  /** Familia con más de un hijo en la sección. */
  students: Array<{ id: string; name: string }>;
}

// ───────────────────────────── Exámenes en línea ─────────────────────────────

export const QUESTION_KINDS = ["opcion", "vf", "abierta"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  opcion: "Selección múltiple",
  vf: "Verdadero o falso",
  abierta: "Respuesta abierta (la revisa el maestro)",
};

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Hora inválida" });

/** Un examen: cuándo abre y cierra, cuánto tiempo hay para resolverlo y su valor en la libreta. */
export const classQuizInputSchema = z
  .object({
    title: z
      .string({ error: "Escribe el título" })
      .trim()
      .min(2, { error: "Escribe el título" })
      .max(150, { error: "Máximo 150 caracteres" }),
    instructions: z.preprocess(
      (v) => (v === undefined || v === null ? "" : v),
      z.string().trim().max(4000, { error: "Máximo 4,000 caracteres" }),
    ),
    opensDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Elige cuándo abre" }),
    opensTime: timeOfDay,
    closesDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Elige cuándo cierra" }),
    closesTime: timeOfDay,
    timeLimitMinutes: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
      z
        .number({ error: "Escribe los minutos" })
        .int({ error: "Minutos enteros" })
        .min(1, { error: "Al menos 1 minuto" })
        .max(600, { error: "Máximo 10 horas" })
        .optional(),
    ),
    shuffle: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
    points: optionalPoints,
    periodId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.uuid().optional()),
  })
  .refine((v) => v.points === undefined || v.periodId, {
    error: "Elige en qué parcial cuenta",
    path: ["periodId"],
  })
  .refine((v) => `${v.closesDate}T${v.closesTime}` > `${v.opensDate}T${v.opensTime}`, {
    error: "Tiene que cerrar después de abrir",
    path: ["closesDate"],
  });
export type ClassQuizInput = z.infer<typeof classQuizInputSchema>;

/** Una pregunta. En selección múltiple, `correct` es el número de la opción buena (desde 0). */
export const quizQuestionInputSchema = z
  .object({
    kind: z.enum(QUESTION_KINDS, { error: "Elige el tipo de pregunta" }),
    prompt: z
      .string({ error: "Escribe la pregunta" })
      .trim()
      .min(2, { error: "Escribe la pregunta" })
      .max(2000, { error: "Máximo 2,000 caracteres" }),
    options: z
      .array(z.string().trim().max(500, { error: "Máximo 500 caracteres por opción" }))
      .max(8, { error: "Máximo 8 opciones" })
      .default([]),
    correct: z.union([z.number().int().min(0), z.boolean(), z.null()]).default(null),
    points: z.preprocess(
      (v) => (typeof v === "string" ? Number(v) : v),
      z.number({ error: "Escribe el valor" }).positive({ error: "Debe valer más de 0" }).max(100),
    ),
  })
  .transform((q) => ({
    ...q,
    options: q.kind === "opcion" ? q.options.filter((o) => o.length > 0) : [],
  }))
  .refine((q) => q.kind !== "opcion" || q.options.length >= 2, {
    error: "Escribe al menos dos opciones",
    path: ["options"],
  })
  .refine(
    (q) =>
      q.kind === "abierta" ||
      (q.kind === "vf" && typeof q.correct === "boolean") ||
      (q.kind === "opcion" && typeof q.correct === "number" && q.correct < q.options.length),
    { error: "Marca la respuesta correcta", path: ["correct"] },
  );
export type QuizQuestionInput = z.input<typeof quizQuestionInputSchema>;

/** Respuestas del alumno: por pregunta, el número de opción, verdadero/falso o el texto. */
export const quizAnswersInputSchema = z.object({
  answers: z.record(z.uuid(), z.union([z.number().int().min(0), z.boolean(), z.string().max(8000)])),
  /** true = entregar el examen. */
  finish: z.boolean().default(false),
});
export type QuizAnswersInput = z.input<typeof quizAnswersInputSchema>;

/** Puntos que el maestro le da a cada respuesta abierta. */
export const quizReviewInputSchema = z.object({
  /** Puntos de las preguntas abiertas. */
  points: z.record(z.uuid(), z.number().min(0).max(100)).default({}),
  /** Comentario por pregunta (vacío lo quita). */
  comments: z
    .record(z.uuid(), z.string().trim().max(500, { error: "Un comentario lleva hasta 500 caracteres" }))
    .optional(),
  /** Comentario general (vacío lo quita). */
  feedback: z.string().trim().max(1000, { error: "El comentario lleva hasta 1000 caracteres" }).optional(),
});

export type QuizStatus = "proximo" | "disponible" | "en_curso" | "entregado" | "calificado" | "cerrado";
export const QUIZ_STATUS_LABELS: Record<QuizStatus, string> = {
  proximo: "Todavía no abre",
  disponible: "Disponible",
  en_curso: "Lo estás resolviendo",
  entregado: "Entregado (falta revisar)",
  calificado: "Calificado",
  cerrado: "No lo presentó",
};

export interface QuizQuestionDto {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  points: number;
  /** Solo para el maestro, o para el alumno cuando el examen ya cerró. */
  correct: number | boolean | null;
}

export interface ClassQuizDto {
  id: string;
  assignmentId: string;
  title: string;
  instructions: string;
  opensAt: string;
  closesAt: string;
  opensDate: string;
  opensTime: string;
  closesDate: string;
  closesTime: string;
  timeLimitMinutes: number | null;
  shuffle: boolean;
  published: boolean;
  /** Valor en la libreta (null: sin nota). */
  points: number | null;
  periodId: string | null;
  periodName: string | null;
  questionCount: number;
  /** Suma de los puntos de las preguntas (la nota se lleva a `points`). */
  rawPoints: number;
  /** Para quien da la clase. */
  stats: { total: number; submitted: number; graded: number } | null;
  /** Para el alumno o su familia. */
  status: QuizStatus | null;
  myScore: number | null;
}

export interface QuizAnswerReviewDto {
  questionId: string;
  answer: number | boolean | string | null;
  /** null: abierta todavía sin revisar. */
  points: number | null;
  /** Lo que el maestro comentó en esta pregunta. */
  comment: string | null;
}

export interface QuizAttemptDto {
  studentId: string;
  studentName: string;
  startedAt: string | null;
  /** Hasta cuándo puede responder (el tiempo límite o el cierre del examen). */
  deadline: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  answers: QuizAnswerReviewDto[];
  /** Puntos sobre `rawPoints` y la nota llevada al valor de la libreta. */
  rawScore: number | null;
  score: number | null;
  /** Faltan preguntas abiertas por revisar. */
  pendingReview: boolean;
  /** Comentario general del maestro. */
  feedback: string | null;
  status: QuizStatus;
}

export interface ClassQuizDetailDto {
  quiz: ClassQuizDto;
  subjectName: string;
  sectionLabel: string;
  viewer: ClassViewer;
  canEdit: boolean;
  /** El maestro ve las respuestas correctas; el alumno, cuando ya cerró. */
  questions: QuizQuestionDto[];
  /** Para quien da la clase: un renglón por alumno. */
  attempts: QuizAttemptDto[] | null;
  /** Para el alumno o su familia. */
  mine: QuizAttemptDto | null;
  students: Array<{ id: string; name: string }>;
}
