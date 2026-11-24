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
}
