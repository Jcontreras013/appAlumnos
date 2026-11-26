"use client";

import { matchesSearch } from "@escolar/shared";
import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { Fold, FoldTag } from "@/components/fold";

/**
 * Búsqueda (y, si hace falta, un selector de grupo como la sección o el distrito) para tablas y
 * listas que arma el servidor. Filtra en el navegador, sin volver a pedir nada: cada fila dice su
 * texto (`FilterRow text=…`) y el ámbito recibe la misma lista para contar cuántas coinciden.
 *
 *   <FilterScope items={rows.map((r) => ({ text: r.name, group: r.sectionId }))}>
 *     <FilterBar placeholder="Buscar alumno" groups={sections} />
 *     <table><tbody>{rows.map((r) => <FilterRow key={r.id} text={r.name} group={r.sectionId}>…</FilterRow>)}</tbody></table>
 *     <FilterEmpty />
 *   </FilterScope>
 */

export interface FilterItem {
  text: string;
  group?: string;
}

interface FilterState {
  query: string;
  setQuery: (q: string) => void;
  group: string;
  setGroup: (g: string) => void;
  shown: number;
  total: number;
}

const ALL = "";
const Ctx = createContext<FilterState | null>(null);

const useFilter = () => {
  const state = useContext(Ctx);
  if (!state) throw new Error("FilterRow, FilterBar y FilterEmpty van dentro de un FilterScope");
  return state;
};

const matches = (item: FilterItem, query: string, group: string) =>
  (group === ALL || item.group === group) && matchesSearch(item.text, query);

export function FilterScope({ items, children }: { items: FilterItem[]; children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(ALL);
  const shown = items.filter((i) => matches(i, query, group)).length;
  return (
    <Ctx.Provider value={{ query, setQuery, group, setGroup, shown, total: items.length }}>
      {children}
    </Ctx.Provider>
  );
}

export function FilterBar({
  placeholder,
  groups,
  groupLabel = "Sección",
  allLabel = "Todas",
}: {
  placeholder: string;
  /** Opciones del selector (por ejemplo, las secciones). Sin opciones no se muestra. */
  groups?: Array<{ value: string; label: string }>;
  groupLabel?: string;
  allLabel?: string;
}) {
  const { query, setQuery, group, setGroup, shown, total } = useFilter();
  const id = useId();
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="input min-w-56 flex-1 sm:max-w-sm"
      />
      {groups && groups.length > 1 && (
        <>
          <label htmlFor={id} className="sr-only">
            {groupLabel}
          </label>
          <select id={id} value={group} onChange={(e) => setGroup(e.target.value)} className="input w-auto">
            <option value={ALL}>
              {groupLabel}: {allLabel.toLowerCase()}
            </option>
            {groups.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </>
      )}
      {(query.trim() || group !== ALL) && (
        <span className="text-xs text-slate-500">
          {shown} de {total}
        </span>
      )}
    </div>
  );
}

const ROW_TAGS = { tr: "tr", li: "li", div: "div" } as const;

export function FilterRow({
  text,
  group,
  as = "tr",
  className,
  children,
}: {
  text: string;
  group?: string;
  as?: keyof typeof ROW_TAGS;
  className?: string;
  children: ReactNode;
}) {
  const { query, group: selected } = useFilter();
  if (!matches({ text, group }, query, selected)) return null;
  const Tag = ROW_TAGS[as];
  return <Tag className={className}>{children}</Tag>;
}

/** Mensaje cuando nada coincide, con un botón para volver a ver todo. */
export function FilterEmpty({ message = "Nada coincide con la búsqueda." }: { message?: string }) {
  const { shown, total, setQuery, setGroup } = useFilter();
  if (total === 0 || shown > 0) return null;
  return (
    <div className="px-4 py-6 text-center text-sm text-slate-500">
      <p>{message}</p>
      <button
        type="button"
        className="mt-2 font-semibold text-brand-700 hover:underline"
        onClick={() => {
          setQuery("");
          setGroup(ALL);
        }}
      >
        Ver todo
      </button>
    </div>
  );
}

/**
 * Un grupo desplegable dentro de una lista con buscador (por ejemplo, el personal por cargo). Viene
 * cerrado; al buscar o elegir un grupo se abre solo, y se esconde si no tiene nada que coincida.
 */
export function FilterFold({
  title,
  items,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  items: FilterItem[];
  /** Abierto al llegar (por ejemplo, el día de hoy en la bitácora). */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { query, group } = useFilter();
  const filtering = query.trim() !== "" || group !== ALL;
  const shown = items.filter((i) => matches(i, query, group)).length;
  if (filtering && shown === 0) return null;
  return (
    <Fold
      title={title}
      open={filtering || defaultOpen}
      className="rounded-none border-x-0 border-b-0 shadow-none"
      summary={<FoldTag>{filtering ? `${shown} de ${items.length}` : items.length}</FoldTag>}
    >
      {children}
    </Fold>
  );
}
