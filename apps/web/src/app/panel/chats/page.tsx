import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Chats" };

const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date().toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa" });
  const day = date.toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa" });
  return day === today
    ? date.toLocaleTimeString("es-HN", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Tegucigalpa",
      })
    : date.toLocaleDateString("es-HN", { day: "numeric", month: "short", timeZone: "America/Tegucigalpa" });
};

/** Los chats de las clases en un solo lugar (el maestro, sus clases; el alumno, las de su sección). */
export default async function ChatsPage() {
  const session = await requireRole("docente", "estudiante", "admin", "coordinador");
  const chats = await academic.classChats(session.accessToken);
  const role = session.user.role;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Chats</h1>
        <p className="mt-1 text-sm text-slate-500">
          {role === "docente"
            ? "El chat de cada una de tus clases. Tú lo abres o lo cierras y puedes borrar mensajes."
            : role === "estudiante"
              ? "El chat de cada clase con tu maestro y tus compañeros."
              : "Los chats de las clases que están abiertos o tienen mensajes. Puedes leerlos y moderarlos."}
        </p>
      </div>
      {chats.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-500">
          {role === "admin" || role === "coordinador"
            ? "Ninguna clase tiene el chat abierto todavía."
            : "Todavía no tienes clases este año."}
        </p>
      ) : (
        <ul className="card divide-y divide-slate-100 overflow-hidden">
          {chats.map((c) => (
            <li key={c.assignmentId}>
              <Link
                href={`/panel/chats/${c.assignmentId}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    c.enabled ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-400"
                  }`}
                  aria-hidden="true"
                >
                  {c.subjectName.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">
                      {c.subjectName} · {c.sectionLabel}
                    </span>
                    {c.last && (
                      <span className="shrink-0 text-xs text-slate-400">{when(c.last.createdAt)}</span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-slate-500">
                    {c.last
                      ? `${c.last.authorName}: ${c.last.body ?? "Mensaje borrado"}`
                      : c.enabled
                        ? "Abierto · todavía sin mensajes"
                        : "Cerrado"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
