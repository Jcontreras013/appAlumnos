import { z } from "zod";
import { MONTH_NAMES } from "./format";

/*
 * Documentos del centro: circulares, actas, informes, oficios, constancias y listados, con títulos,
 * listas y tablas. Se escriben en CONECTA y se descargan en Word o se imprimen/guardan en PDF con el
 * membrete del centro. El contenido es el JSON del editor (ProseMirror/TipTap), con solo los
 * elementos que el editor ofrece: así no se puede guardar HTML ni nada que el editor no sepa mostrar.
 */

export const DOCUMENT_VISIBILITIES = ["privado", "personal"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  privado: "Solo yo",
  personal: "Todo el personal del centro",
};

/** Tope del contenido guardado (unas 60 páginas de texto). */
export const DOCUMENT_MAX_CHARS = 300_000;

// ───────────────────────────── Contenido ─────────────────────────────

export const DOC_NODE_TYPES = [
  "paragraph",
  "heading",
  "text",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "horizontalRule",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
] as const;
export type DocNodeType = (typeof DOC_NODE_TYPES)[number];
export const DOC_MARKS = ["bold", "italic", "underline"] as const;
export type DocMark = (typeof DOC_MARKS)[number];
export const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export interface DocNode {
  type: DocNodeType;
  attrs?: {
    level?: number;
    textAlign?: TextAlign | null;
    start?: number;
    colspan?: number;
    rowspan?: number;
    colwidth?: number[] | null;
  };
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: DocMark }>;
}
export interface DocContent {
  type: "doc";
  content: DocNode[];
}

const nodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.enum(DOC_NODE_TYPES),
    // Solo los atributos que usa el editor; cualquier otro se descarta.
    attrs: z
      .object({
        level: z.number().int().min(1).max(3).optional(),
        textAlign: z.enum(TEXT_ALIGNS).nullable().optional(),
        start: z.number().int().min(0).max(100_000).optional(),
        colspan: z.number().int().min(1).max(30).optional(),
        rowspan: z.number().int().min(1).max(200).optional(),
        colwidth: z.array(z.number().min(0).max(4000)).max(30).nullable().optional(),
      })
      .optional(),
    content: z.array(nodeSchema).max(5000).optional(),
    text: z.string().max(50_000).optional(),
    marks: z
      .array(z.object({ type: z.enum(DOC_MARKS) }))
      .max(DOC_MARKS.length)
      .optional(),
  }),
);

export const documentContentSchema = z
  .object({ type: z.literal("doc"), content: z.array(nodeSchema).max(10_000) })
  .refine((doc) => JSON.stringify(doc).length <= DOCUMENT_MAX_CHARS, {
    error: "El documento es demasiado largo. Divídelo en dos.",
  });

export const EMPTY_DOCUMENT: DocContent = { type: "doc", content: [{ type: "paragraph" }] };

// ───────────────────────────── Plantillas ─────────────────────────────

export const DOCUMENT_TEMPLATES = [
  "blanco",
  "circular",
  "acta",
  "informe",
  "oficio",
  "constancia",
  "listado",
] as const;
export type DocumentTemplate = (typeof DOCUMENT_TEMPLATES)[number];

export const DOCUMENT_TEMPLATE_INFO: Record<DocumentTemplate, { label: string; description: string }> = {
  blanco: { label: "Documento en blanco", description: "Empieza desde cero." },
  circular: {
    label: "Circular a padres de familia",
    description: "Avisos y comunicados a las familias, con número, asunto y firma.",
  },
  acta: {
    label: "Acta de reunión",
    description: "Agenda, desarrollo, tabla de acuerdos y firmas de los asistentes.",
  },
  informe: {
    label: "Informe",
    description: "Datos generales, objetivo, actividades, resultados y recomendaciones.",
  },
  oficio: { label: "Oficio o carta", description: "Carta formal a una autoridad o institución." },
  constancia: { label: "Constancia", description: "Hace constar un hecho, con lugar, fecha y firma." },
  listado: { label: "Listado", description: "Tabla numerada para listas de alumnos, entregas o firmas." },
};

export interface TemplateContext {
  schoolName: string;
  /** Fecha AAAA-MM-DD. */
  date: string;
  authorName: string;
}

const text = (value: string, marks?: DocMark[]): DocNode =>
  marks?.length
    ? { type: "text", text: value, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: value };
const para = (parts: Array<string | DocNode> = [], textAlign?: TextAlign): DocNode => {
  const content = parts.filter((p) => p !== "").map((p) => (typeof p === "string" ? text(p) : p));
  return {
    type: "paragraph",
    ...(textAlign ? { attrs: { textAlign } } : {}),
    ...(content.length ? { content } : {}),
  };
};
const heading = (level: 1 | 2 | 3, value: string, textAlign?: TextAlign): DocNode => ({
  type: "heading",
  attrs: { level, ...(textAlign ? { textAlign } : {}) },
  content: [text(value)],
});
const list = (type: "bulletList" | "orderedList", items: string[]): DocNode => ({
  type,
  content: items.map((item) => ({ type: "listItem", content: [para([item])] })),
});
const cell = (type: "tableHeader" | "tableCell", value: string): DocNode => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [para(value ? [value] : [])],
});
export const docTable = (headers: string[], rows: string[][]): DocNode => ({
  type: "table",
  content: [
    { type: "tableRow", content: headers.map((h) => cell("tableHeader", h)) },
    ...rows.map((row) => ({ type: "tableRow" as const, content: row.map((v) => cell("tableCell", v)) })),
  ],
});
const labeled = (label: string, value: string) => para([text(`${label} `, ["bold"]), value]);
const blankRows = (columns: number, count: number) =>
  Array.from({ length: count }, () => Array.from({ length: columns }, () => ""));
const signature = (name: string, role: string) => [
  para(),
  para(),
  para(["______________________________"], "center"),
  para([name], "center"),
  para([role], "center"),
];

/** «21 de noviembre de 2026». */
function longDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return `${day} de ${MONTH_NAMES[month - 1]} de ${year}`;
}

/** Título y contenido inicial de cada plantilla, con los datos del centro ya puestos. */
export function documentTemplate(
  key: DocumentTemplate,
  ctx: TemplateContext,
): { title: string; content: DocContent } {
  const school = ctx.schoolName || "el centro educativo";
  const date = longDate(ctx.date);
  const [year, month, day] = ctx.date.split("-").map(Number) as [number, number, number];
  const doc = (content: DocNode[]): DocContent => ({ type: "doc", content });
  switch (key) {
    case "circular":
      return {
        title: "Circular a padres de familia",
        content: doc([
          heading(1, "CIRCULAR No. ___", "center"),
          labeled("Para:", "Padres de familia y encargados"),
          labeled("De:", `Dirección de ${school}`),
          labeled("Fecha:", date),
          labeled("Asunto:", "________________"),
          para(),
          para(["Estimados padres de familia:"]),
          para(["[Escriba aquí el mensaje: qué, cuándo, dónde y qué se espera de las familias.]"]),
          para(["Agradecemos de antemano su atención y colaboración."]),
          para(["Atentamente,"]),
          ...signature(ctx.authorName, "Firma y sello"),
        ]),
      };
    case "acta":
      return {
        title: "Acta de reunión",
        content: doc([
          heading(1, "ACTA No. ___", "center"),
          para([
            `En las instalaciones de ${school}, siendo las ____ horas del día ${date}, se reunieron las personas que firman al final de esta acta para tratar la siguiente agenda:`,
          ]),
          heading(2, "Agenda"),
          list("orderedList", [
            "Comprobación de asistencia.",
            "Lectura del acta anterior.",
            "________________",
            "Puntos varios.",
          ]),
          heading(2, "Desarrollo"),
          para(["[Resumen de lo tratado en cada punto de la agenda.]"]),
          heading(2, "Acuerdos"),
          docTable(["Acuerdo", "Responsable", "Fecha límite"], blankRows(3, 3)),
          para(["Sin otro punto que tratar, se cierra la sesión a las ____ horas del mismo día."]),
          heading(2, "Asistentes"),
          docTable(["Nombre", "Cargo", "Firma"], blankRows(3, 5)),
        ]),
      };
    case "informe":
      return {
        title: "Informe",
        content: doc([
          heading(1, "INFORME DE ________", "center"),
          docTable(
            ["Dato", "Detalle"],
            [
              ["Centro educativo", school],
              ["Elaborado por", ctx.authorName],
              ["Fecha", date],
              ["Período que cubre", ""],
            ],
          ),
          heading(2, "1. Objetivo"),
          para(["[Para qué se hace este informe.]"]),
          heading(2, "2. Actividades realizadas"),
          list("bulletList", ["________________", "________________"]),
          heading(2, "3. Resultados"),
          para(["[Qué se logró, con datos si los hay.]"]),
          heading(2, "4. Dificultades"),
          para(["[Qué no salió como se esperaba y por qué.]"]),
          heading(2, "5. Recomendaciones"),
          para(["[Qué se propone hacer.]"]),
          ...signature(ctx.authorName, ""),
        ]),
      };
    case "oficio":
      return {
        title: "Oficio",
        content: doc([
          para([school], "right"),
          para(["Oficio No. ___"], "right"),
          para([date], "right"),
          para(),
          para([text("Señor(a): ________________", ["bold"])]),
          para(["Cargo: ________________"]),
          para(["Presente."]),
          para(),
          para(["Respetable señor(a):"]),
          para(["[Escriba aquí el motivo del oficio.]"]),
          para(["Sin otro particular, me suscribo de usted con muestras de consideración y respeto."]),
          para(["Atentamente,"]),
          ...signature(ctx.authorName, school),
        ]),
      };
    case "constancia":
      return {
        title: "Constancia",
        content: doc([
          heading(1, "CONSTANCIA", "center"),
          para(),
          para(
            [
              `La Dirección de ${school} hace constar que ________________, con número de identidad ________________, ________________.`,
            ],
            "justify",
          ),
          para(
            [
              `Y para los fines que al interesado convengan, se extiende la presente a los ${day} días del mes de ${MONTH_NAMES[month - 1]} de ${year}.`,
            ],
            "justify",
          ),
          ...signature(ctx.authorName, "Firma y sello"),
        ]),
      };
    case "listado":
      return {
        title: "Listado",
        content: doc([
          heading(1, "LISTADO DE ________", "center"),
          para([text("Grado y sección: ", ["bold"]), "________     ", text("Fecha: ", ["bold"]), date]),
          docTable(
            ["No.", "Nombre completo", "Observaciones"],
            Array.from({ length: 10 }, (_, i) => [String(i + 1), "", ""]),
          ),
        ]),
      };
    default:
      return { title: "Documento sin título", content: EMPTY_DOCUMENT };
  }
}

// ───────────────────────────── Entradas y DTOs ─────────────────────────────

const titleSchema = z.string().trim().min(1, { error: "Escribe el título" }).max(120);

export const createDocumentInputSchema = z.object({
  title: titleSchema,
  template: z.enum(DOCUMENT_TEMPLATES).default("blanco"),
  content: documentContentSchema.optional(),
  visibility: z.enum(DOCUMENT_VISIBILITIES).default("privado"),
});
export type CreateDocumentInput = z.input<typeof createDocumentInputSchema>;

export const saveDocumentInputSchema = z.object({
  title: titleSchema,
  content: documentContentSchema,
  visibility: z.enum(DOCUMENT_VISIBILITIES),
  /** La versión que se estaba editando: si otra ventana guardó antes, no se pisa. */
  version: z.number().int().min(1),
});
export type SaveDocumentInput = z.infer<typeof saveDocumentInputSchema>;

export interface DocumentSummaryDto {
  id: string;
  title: string;
  template: DocumentTemplate;
  visibility: DocumentVisibility;
  authorName: string;
  mine: boolean;
  updatedAt: string;
}

export interface DocumentDto extends DocumentSummaryDto {
  content: DocContent;
  version: number;
  canEdit: boolean;
}
