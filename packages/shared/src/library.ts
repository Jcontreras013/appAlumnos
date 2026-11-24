import { z } from "zod";

/*
 * Biblioteca virtual del centro: libros de texto, guías y lecturas en PDF (y documentos de Word, Excel
 * o PowerPoint), o enlaces (Educatrachos, videos), por grado y materia. Los sube el personal; las
 * familias ven lo que se compartió con ellas para los grados de sus hijos.
 */

export const LIBRARY_KINDS = ["archivo", "enlace"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const LIBRARY_AUDIENCES = ["personal", "familias"] as const;
export type LibraryAudience = (typeof LIBRARY_AUDIENCES)[number];
export const LIBRARY_AUDIENCE_LABELS: Record<LibraryAudience, string> = {
  personal: "Solo el personal",
  familias: "Personal y familias",
};

/** Tipos de archivo que acepta la biblioteca: el PDF se lee en CONECTA; los demás se descargan. */
export const LIBRARY_FILE_TYPES: Record<string, { ext: string; label: string }> = {
  "application/pdf": { ext: "pdf", label: "PDF" },
  "application/msword": { ext: "doc", label: "Word" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", label: "Word" },
  "application/vnd.ms-excel": { ext: "xls", label: "Excel" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", label: "Excel" },
  "application/vnd.ms-powerpoint": { ext: "ppt", label: "PowerPoint" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    ext: "pptx",
    label: "PowerPoint",
  },
};

/** Un libro de texto escaneado puede pesar bastante. */
export const LIBRARY_MAX_BYTES = 80 * 1024 * 1024;

/** El tipo de un archivo por lo que dice el navegador o, si no lo dice, por su extensión. */
export function libraryTypeOf(fileName: string, declared?: string): string | null {
  if (declared && Object.hasOwn(LIBRARY_FILE_TYPES, declared)) return declared;
  const ext = fileName.split(".").pop()?.toLowerCase();
  const found = Object.entries(LIBRARY_FILE_TYPES).find(([, t]) => t.ext === ext);
  return found ? found[0] : null;
}

const optionalId = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.uuid().optional());
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const metaShape = {
  title: z.string().trim().min(2, { error: "Escribe el título" }).max(150),
  description: optionalText(500),
  gradeId: optionalId,
  subjectId: optionalId,
  audience: z.enum(LIBRARY_AUDIENCES, { error: "Elige quién lo puede ver" }),
};

/** Datos de un archivo que se sube (van en la dirección de la petición; el cuerpo es el archivo). */
export const libraryFileMetaSchema = z.object(metaShape);
export type LibraryFileMeta = z.infer<typeof libraryFileMetaSchema>;

export const libraryLinkInputSchema = z.object({
  ...metaShape,
  url: z
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
      { error: "Pega un enlace que empiece con https://" },
    ),
});
export type LibraryLinkInput = z.input<typeof libraryLinkInputSchema>;

export interface LibraryItemDto {
  id: string;
  kind: LibraryKind;
  title: string;
  description: string | null;
  /** Solo en los enlaces. */
  url: string | null;
  /** Solo en los archivos. */
  file: { name: string; contentType: string; size: number } | null;
  gradeId: string | null;
  gradeName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  audience: LibraryAudience;
  uploadedByName: string;
  createdAt: string;
  canDelete: boolean;
}
