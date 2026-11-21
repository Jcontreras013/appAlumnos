import { describe, expect, it } from "vitest";
import { DOCUMENT_MAX_CHARS, DOCUMENT_TEMPLATES, documentContentSchema, documentTemplate } from "./documents";

const ctx = { schoolName: "Escuela Demo West End", date: "2026-11-21", authorName: "Sofía Secretaria" };

describe("plantillas de documentos", () => {
  it("cada plantilla es contenido válido para el editor y trae los datos del centro", () => {
    for (const key of DOCUMENT_TEMPLATES) {
      const { title, content } = documentTemplate(key, ctx);
      expect(title.length).toBeGreaterThan(0);
      expect(documentContentSchema.safeParse(content).success, key).toBe(true);
    }
    expect(JSON.stringify(documentTemplate("acta", ctx).content)).toContain("Escuela Demo West End");
    expect(JSON.stringify(documentTemplate("circular", ctx).content)).toContain("21 de noviembre de 2026");
    expect(JSON.stringify(documentTemplate("constancia", ctx).content)).toContain(
      "21 días del mes de noviembre de 2026",
    );
  });

  it("el acta trae la tabla de acuerdos y la de firmas", () => {
    const tables = documentTemplate("acta", ctx).content.content.filter((n) => n.type === "table");
    expect(tables).toHaveLength(2);
    expect(tables[1]?.content?.length).toBe(6); // encabezado + 5 firmas
  });
});

describe("contenido permitido", () => {
  it("no acepta lo que el editor no ofrece (HTML, enlaces, imágenes)", () => {
    const withLink = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link" }] }] }],
    };
    expect(documentContentSchema.safeParse(withLink).success).toBe(false);
    const withImage = { type: "doc", content: [{ type: "image", attrs: { src: "https://x" } }] };
    expect(documentContentSchema.safeParse(withImage).success).toBe(false);
  });

  it("descarta atributos desconocidos", () => {
    const parsed = documentContentSchema.parse({
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: "center", onclick: "alert(1)" } }],
    });
    expect(parsed.content[0]?.attrs).toEqual({ textAlign: "center" });
  });

  it("un documento demasiado largo se rechaza", () => {
    const huge = {
      type: "doc",
      content: Array.from({ length: 20 }, () => ({
        type: "paragraph",
        content: [{ type: "text", text: "x".repeat(DOCUMENT_MAX_CHARS / 10) }],
      })),
    };
    expect(documentContentSchema.safeParse(huge).success).toBe(false);
  });
});
