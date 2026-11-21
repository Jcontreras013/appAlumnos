import type { DocContent, DocMark, DocNode, TextAlign } from "@escolar/shared";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/*
 * Documento de CONECTA → archivo de Word (.docx), en el navegador. Tamaño carta, letra Arial y el
 * membrete del centro (logo y nombre) en cada página. Lo que no tiene equivalente en Word se omite.
 */

const ALIGN: Record<TextAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
const NUMBERED = "numerada";

type Block = Paragraph | Table;

function runs(nodes: DocNode[] | undefined): TextRun[] {
  const out: TextRun[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      out.push(new TextRun({ text: "", break: 1 }));
    } else if (node.type === "text" && node.text) {
      const marks = new Set<DocMark>((node.marks ?? []).map((m) => m.type));
      out.push(
        new TextRun({
          text: node.text,
          bold: marks.has("bold") || undefined,
          italics: marks.has("italic") || undefined,
          underline: marks.has("underline") ? {} : undefined,
        }),
      );
    }
  }
  return out;
}

interface ListContext {
  kind: "bullet" | "ordered";
  level: number;
  instance: number;
}

/** Convierte bloques; `list` indica que están dentro de una lista (viñeta o número y nivel). */
function blocks(nodes: DocNode[] | undefined, state: { instances: number }, list?: ListContext): Block[] {
  const out: Block[] = [];
  for (const node of nodes ?? []) {
    const alignment = node.attrs?.textAlign ? ALIGN[node.attrs.textAlign] : undefined;
    switch (node.type) {
      case "paragraph":
        out.push(new Paragraph({ children: runs(node.content), alignment, spacing: { after: 120 } }));
        break;
      case "heading":
        out.push(
          new Paragraph({
            children: runs(node.content),
            heading: HEADING[Math.min(3, Math.max(1, node.attrs?.level ?? 1)) - 1],
            alignment,
          }),
        );
        break;
      case "bulletList":
      case "orderedList": {
        const kind = node.type === "bulletList" ? "bullet" : "ordered";
        const level = list ? list.level + 1 : 0;
        const instance = kind === "ordered" ? ++state.instances : 0;
        for (const item of node.content ?? []) {
          let first = true;
          for (const child of item.content ?? []) {
            if (child.type === "paragraph" && first) {
              first = false;
              out.push(
                new Paragraph({
                  children: runs(child.content),
                  alignment: child.attrs?.textAlign ? ALIGN[child.attrs.textAlign] : undefined,
                  ...(kind === "bullet"
                    ? { bullet: { level: Math.min(level, 8) } }
                    : { numbering: { reference: NUMBERED, level: Math.min(level, 8), instance } }),
                }),
              );
            } else {
              out.push(...blocks([child], state, { kind, level, instance }));
            }
          }
        }
        break;
      }
      case "blockquote":
        for (const b of blocks(node.content, state, list)) {
          out.push(b instanceof Paragraph ? b : b);
        }
        break;
      case "horizontalRule":
        out.push(
          new Paragraph({
            children: [],
            border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } },
          }),
        );
        break;
      case "table":
        out.push(table(node, state));
        break;
      default:
        break;
    }
  }
  return out;
}

function table(node: DocNode, state: { instances: number }): Table {
  const rows = (node.content ?? []).map((row) => {
    const cells = row.content ?? [];
    const header = cells.length > 0 && cells.every((c) => c.type === "tableHeader");
    return new TableRow({
      tableHeader: header,
      children: cells.map((cell) => {
        const content = blocks(cell.content, state);
        return new TableCell({
          children: content.length ? content : [new Paragraph({ children: [] })],
          columnSpan: cell.attrs?.colspan ?? 1,
          rowSpan: cell.attrs?.rowspan ?? 1,
          ...(cell.type === "tableHeader"
            ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "E4F2EB" } }
            : {}),
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        });
      }),
    });
  });
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** El logo del centro para el membrete (solo PNG o JPG, que es lo que Word acepta sin conversión). */
async function logoRun(logoUrl: string | null): Promise<ImageRun | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : null;
    if (!type) return null;
    const bitmap = await createImageBitmap(blob);
    const height = 48;
    const width = Math.round((bitmap.width / bitmap.height) * height);
    bitmap.close();
    return new ImageRun({ type, data: await blob.arrayBuffer(), transformation: { width, height } });
  } catch {
    return null;
  }
}

export async function downloadDocx(options: {
  title: string;
  content: DocContent;
  schoolName: string;
  logoUrl: string | null;
}) {
  const logo = await logoRun(options.logoUrl);
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: { color: "086F57", space: 4, style: BorderStyle.SINGLE, size: 8 } },
        children: [
          ...(logo ? [logo, new TextRun({ text: "   " })] : []),
          new TextRun({ text: options.schoolName, bold: true, size: 26, color: "13201C" }),
        ],
      }),
    ],
  });
  const heading = (id: string, name: string, size: number) => ({
    id,
    name,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
    run: { font: "Arial", size, bold: true, color: "13201C" },
    paragraph: { spacing: { before: 240, after: 120 } },
  });
  const doc = new Document({
    title: options.title,
    creator: "CONECTA",
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        heading("Heading1", "Heading 1", 32),
        heading("Heading2", "Heading 2", 26),
        heading("Heading3", "Heading 3", 24),
      ],
    },
    numbering: {
      config: [
        {
          reference: NUMBERED,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: level % 2 === 0 ? LevelFormat.DECIMAL : LevelFormat.LOWER_LETTER,
            text: level % 2 === 0 ? `%${level + 1}.` : `%${level + 1})`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          // Carta (8.5 × 11 pulgadas) con márgenes de 2.5 cm, como se usa en Honduras.
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1418, right: 1418, bottom: 1418, left: 1418, header: 708 },
          },
        },
        headers: { default: header },
        children: blocks(options.content.content, { instances: 0 }),
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${options.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "documento"}.docx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
