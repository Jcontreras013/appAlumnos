"use client";

import {
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_LABELS,
  type DocContent,
  type DocumentDto,
  type DocumentVisibility,
} from "@escolar/shared";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { saveDocumentAction } from "../actions";
import { DownloadWordButton } from "./download-word";

/** Solo lo que el documento sabe guardar (ver documentContentSchema): sin código, tachado ni enlaces. */
export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    code: false,
    codeBlock: false,
    strike: false,
    link: false,
  }),
  TableKit.configure({ table: { resizable: false } }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
];

type Status = { kind: "idle" | "dirty" | "saving" | "saved" } | { kind: "error"; message: string };

export function DocumentEditor({
  doc,
  schoolName,
  logoUrl,
}: {
  doc: DocumentDto;
  schoolName: string;
  logoUrl: string | null;
}) {
  const [title, setTitle] = useState(doc.title);
  const [visibility, setVisibility] = useState<DocumentVisibility>(doc.visibility);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const version = useRef(doc.version);
  const [, startSaving] = useTransition();

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: doc.content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "doc-content min-h-[60vh] px-6 py-5 outline-none sm:px-10",
        "aria-label": "Contenido del documento",
      },
    },
    onUpdate: () => setStatus({ kind: "dirty" }),
  });

  const dirty = status.kind === "dirty" || status.kind === "error";

  const save = useCallback(() => {
    if (!editor) return;
    setStatus({ kind: "saving" });
    startSaving(async () => {
      const result = await saveDocumentAction(doc.id, {
        title,
        // ProseMirror arma los atributos como objetos sin prototipo, y las acciones del servidor de
        // Next los mandan como referencias opacas (llegan como funciones). Se envía JSON plano.
        content: JSON.parse(JSON.stringify(editor.getJSON())) as DocContent,
        visibility,
        version: version.current,
      });
      if (result.ok) {
        version.current = result.doc.version;
        setStatus({ kind: "saved" });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }, [editor, doc.id, title, visibility]);

  // Ctrl+S (o Cmd+S) guarda; y se avisa antes de salir con cambios sin guardar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
          <div>
            <label htmlFor="doc-title" className="label">
              Título
            </label>
            <input
              id="doc-title"
              className="input"
              value={title}
              maxLength={120}
              onChange={(e) => {
                setTitle(e.target.value);
                setStatus({ kind: "dirty" });
              }}
            />
          </div>
          <div>
            <label htmlFor="doc-visibility" className="label">
              Lo pueden ver
            </label>
            <select
              id="doc-visibility"
              className="input"
              value={visibility}
              onChange={(e) => {
                setVisibility(e.target.value as DocumentVisibility);
                setStatus({ kind: "dirty" });
              }}
            >
              {DOCUMENT_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {DOCUMENT_VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={status.kind === "saving"}>
            {status.kind === "saving" ? "Guardando…" : "Guardar"}
          </button>
          <DownloadWordButton
            title={title}
            getContent={() => (editor?.getJSON() as DocContent | undefined) ?? doc.content}
            schoolName={schoolName}
            logoUrl={logoUrl}
          />
          <a
            href={`/panel/documentos/${doc.id}/imprimir`}
            className="btn-secondary"
            onClick={(e) => {
              if (
                dirty &&
                !window.confirm(
                  "Hay cambios sin guardar: la hoja para imprimir muestra lo guardado. ¿Abrirla igual?",
                )
              )
                e.preventDefault();
            }}
          >
            Imprimir o PDF
          </a>
          <p className="text-sm" role="status" aria-live="polite">
            {status.kind === "dirty" && <span className="text-amber-700">Cambios sin guardar</span>}
            {status.kind === "saved" && <span className="text-brand-700">Guardado</span>}
            {status.kind === "error" && <span className="font-medium text-red-700">{status.message}</span>}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        {editor && <Toolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-9 rounded-md px-2 py-1.5 text-sm font-semibold transition disabled:opacity-40 ${
        active ? "bg-brand-100 text-brand-900" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />;

function Toolbar({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");
  const block = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";
  return (
    <div
      role="toolbar"
      aria-label="Formato"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5"
    >
      <select
        aria-label="Estilo del párrafo"
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        value={block}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") chain().setParagraph().run();
          else
            chain()
              .setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 })
              .run();
        }}
      >
        <option value="p">Texto normal</option>
        <option value="h1">Título</option>
        <option value="h2">Subtítulo</option>
        <option value="h3">Encabezado pequeño</option>
      </select>
      <Divider />
      <ToolButton label="Negrita" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <b>N</b>
      </ToolButton>
      <ToolButton
        label="Cursiva"
        active={editor.isActive("italic")}
        onClick={() => chain().toggleItalic().run()}
      >
        <i>K</i>
      </ToolButton>
      <ToolButton
        label="Subrayado"
        active={editor.isActive("underline")}
        onClick={() => chain().toggleUnderline().run()}
      >
        <u>S</u>
      </ToolButton>
      <Divider />
      <ToolButton
        label="Lista con viñetas"
        active={editor.isActive("bulletList")}
        onClick={() => chain().toggleBulletList().run()}
      >
        •≡
      </ToolButton>
      <ToolButton
        label="Lista numerada"
        active={editor.isActive("orderedList")}
        onClick={() => chain().toggleOrderedList().run()}
      >
        1.≡
      </ToolButton>
      <Divider />
      {(
        [
          ["left", "Alinear a la izquierda", "⇤"],
          ["center", "Centrar", "↔"],
          ["right", "Alinear a la derecha", "⇥"],
          ["justify", "Justificar", "☰"],
        ] as const
      ).map(([align, label, icon]) => (
        <ToolButton
          key={align}
          label={label}
          active={editor.isActive({ textAlign: align })}
          onClick={() => chain().setTextAlign(align).run()}
        >
          {icon}
        </ToolButton>
      ))}
      <Divider />
      <ToolButton
        label="Insertar tabla"
        disabled={inTable}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        Tabla
      </ToolButton>
      {inTable && (
        <>
          <ToolButton label="Agregar fila debajo" onClick={() => chain().addRowAfter().run()}>
            + Fila
          </ToolButton>
          <ToolButton label="Agregar columna a la derecha" onClick={() => chain().addColumnAfter().run()}>
            + Columna
          </ToolButton>
          <ToolButton label="Quitar fila" onClick={() => chain().deleteRow().run()}>
            − Fila
          </ToolButton>
          <ToolButton label="Quitar columna" onClick={() => chain().deleteColumn().run()}>
            − Columna
          </ToolButton>
          <ToolButton
            label="Unir o separar celdas"
            disabled={!editor.can().mergeOrSplit()}
            onClick={() => chain().mergeOrSplit().run()}
          >
            Unir
          </ToolButton>
          <ToolButton label="Quitar la tabla" onClick={() => chain().deleteTable().run()}>
            Quitar tabla
          </ToolButton>
        </>
      )}
      <Divider />
      <ToolButton label="Línea horizontal" onClick={() => chain().setHorizontalRule().run()}>
        ―
      </ToolButton>
      <ToolButton label="Deshacer" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        ↶
      </ToolButton>
      <ToolButton label="Rehacer" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        ↷
      </ToolButton>
    </div>
  );
}
