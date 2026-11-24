"use client";

import {
  formatDate,
  formatFileSize,
  LIBRARY_AUDIENCE_LABELS,
  LIBRARY_FILE_TYPES,
  type LibraryItemDto,
  matchesSearch,
} from "@escolar/shared";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { savedLibraryIds } from "@/lib/library-offline";
import { libraryFileUrl } from "@/lib/library-urls";
import { removeLibraryItemAction } from "./actions";

const ALL = "";
/** Los materiales sin grado (para todo el centro). */
const GENERAL = "general";

const kindLabel = (item: LibraryItemDto) =>
  item.kind === "enlace" ? "Enlace" : (LIBRARY_FILE_TYPES[item.file?.contentType ?? ""]?.label ?? "Archivo");

const isPdf = (item: LibraryItemDto) => item.file?.contentType === "application/pdf";

/** Colores por tipo, para reconocerlos de un vistazo. */
const KIND_STYLE: Record<string, string> = {
  PDF: "bg-red-50 text-red-700",
  Word: "bg-blue-50 text-blue-700",
  Excel: "bg-emerald-50 text-emerald-700",
  PowerPoint: "bg-orange-50 text-orange-700",
  Enlace: "bg-violet-50 text-violet-700",
};

export function LibraryBrowser({ items, family }: { items: LibraryItemDto[]; family: boolean }) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState(ALL);
  const [subject, setSubject] = useState(ALL);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    void savedLibraryIds().then(setSaved);
  }, []);

  const grades = unique(items.map((i) => (i.gradeId ? [i.gradeId, i.gradeName ?? "Grado"] : null)));
  const subjects = unique(items.map((i) => (i.subjectId ? [i.subjectId, i.subjectName ?? "Materia"] : null)));
  const hasGeneral = items.some((i) => !i.gradeId);

  const shown = items.filter(
    (i) =>
      (grade === ALL || (grade === GENERAL ? !i.gradeId : i.gradeId === grade)) &&
      (subject === ALL || i.subjectId === subject) &&
      matchesSearch(
        [i.title, i.description, i.gradeName, i.subjectName, i.file?.name, kindLabel(i)]
          .filter(Boolean)
          .join(" "),
        query,
      ),
  );

  if (items.length === 0) {
    return (
      <section className="card p-8 text-center text-sm text-slate-500">
        {family
          ? "Todavía no hay materiales para el grado de sus hijos. Cuando el centro comparta libros o guías, aparecerán aquí."
          : "La biblioteca está vacía. Sube el primer libro o guía con «Agregar material»."}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="card grid gap-3 p-3 sm:grid-cols-[1fr_12rem_12rem]">
        <div>
          <label htmlFor={`${ids}-q`} className="sr-only">
            Buscar
          </label>
          <input
            id={`${ids}-q`}
            type="search"
            className="input"
            placeholder="Buscar por título, materia o grado"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-g`} className="sr-only">
            Grado
          </label>
          <select id={`${ids}-g`} className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value={ALL}>Todos los grados</option>
            {grades.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {hasGeneral && <option value={GENERAL}>Para todo el centro</option>}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-m`} className="sr-only">
            Materia
          </label>
          <select
            id={`${ids}-m`}
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value={ALL}>Todas las materias</option>
            {subjects.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="px-1 text-xs text-slate-500" aria-live="polite">
        {shown.length === items.length
          ? `${items.length} ${items.length === 1 ? "material" : "materiales"}`
          : `${shown.length} de ${items.length}`}
        {saved.size > 0 && ` · ${saved.size} guardado${saved.size === 1 ? "" : "s"} en este dispositivo`}
      </p>

      {shown.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">Nada coincide con la búsqueda.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((item) => (
            <LibraryCard key={item.id} item={item} family={family} saved={saved.has(item.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LibraryCard({ item, family, saved }: { item: LibraryItemDto; family: boolean; saved: boolean }) {
  const label = kindLabel(item);
  const place = [item.gradeName ?? "Todo el centro", item.subjectName].filter(Boolean).join(" · ");
  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 shrink-0 rounded-md px-2 py-1 text-xs font-bold ${KIND_STYLE[label] ?? "bg-slate-100 text-slate-700"}`}
        >
          {label}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900">{item.title}</h3>
          <p className="text-xs text-slate-500">
            {place}
            {item.file ? ` · ${formatFileSize(item.file.size)}` : ""}
          </p>
        </div>
      </div>
      {item.description && <p className="text-sm text-slate-600">{item.description}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!family && (
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              item.audience === "familias" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {LIBRARY_AUDIENCE_LABELS[item.audience]}
          </span>
        )}
        {saved && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            Guardado en este dispositivo
          </span>
        )}
        <span className="text-slate-400">
          {item.uploadedByName} · {formatDate(item.createdAt)}
        </span>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {item.kind === "enlace" && item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Abrir enlace
          </a>
        ) : isPdf(item) ? (
          <Link href={`/panel/biblioteca/${item.id}`} className="btn-primary">
            Leer
          </Link>
        ) : (
          <a href={libraryFileUrl(item.id)} download={item.file?.name} className="btn-primary">
            Descargar
          </a>
        )}
        {isPdf(item) && (
          <a href={libraryFileUrl(item.id)} download={item.file?.name} className="btn-secondary">
            Descargar
          </a>
        )}
        {item.canDelete && (
          <form
            action={removeLibraryItemAction}
            className="ml-auto"
            onSubmit={(e) => {
              if (!window.confirm(`¿Quitar «${item.title}» de la biblioteca? Ya nadie lo podrá abrir.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className="text-sm font-medium text-red-700 hover:underline">
              Quitar
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

/** Pares [id, nombre] sin repetir, en orden alfabético. */
function unique(pairs: Array<string[] | null>): Array<[string, string]> {
  const map = new Map<string, string>();
  for (const pair of pairs) if (pair?.[0]) map.set(pair[0], pair[1] ?? "");
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "es", { numeric: true }));
}
