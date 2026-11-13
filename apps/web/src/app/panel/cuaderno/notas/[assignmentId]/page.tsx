import { formatDay } from "@escolar/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { Gradebook } from "./gradebook";

export const metadata: Metadata = { title: "Notas" };

export default async function GradebookPage({
  params,
  searchParams,
}: PageProps<"/panel/cuaderno/notas/[assignmentId]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria");
  const { assignmentId } = await params;
  const query = await searchParams;
  const periodo = Array.isArray(query.periodo) ? query.periodo[0] : query.periodo;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(assignmentId)) notFound();

  const book = await academic
    .gradebook(session.accessToken, assignmentId, periodo && uuid.test(periodo) ? periodo : undefined)
    .catch((err) => {
      if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    });
  const { assignment, period, periods } = book;
  // El maestro (o la directora que también da clases) vuelve a su cuaderno; la oficina, al seguimiento.
  const ownClass = session.user.role === "docente" || assignment.teacherUserId === session.user.id;
  const back = ownClass ? "/panel/cuaderno" : "/panel/seguimiento";

  return (
    <div className="space-y-5">
      <div>
        <a href={back} className="text-sm text-slate-500 hover:text-slate-900">
          ← {back === "/panel/cuaderno" ? "Mi cuaderno" : "Seguimiento"}
        </a>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {assignment.subjectName} · {assignment.sectionLabel}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {assignment.teacherName}
          {book.canEdit && assignment.teacherUserId !== session.user.id && session.user.role === "docente"
            ? " (la cubres como sustituto)"
            : ""}{" "}
          · {period.name}: {formatDay(period.startsOn)} al {formatDay(period.endsOn)}
        </p>
      </div>

      <nav aria-label="Parciales" className="flex flex-wrap items-center gap-1">
        {periods.map((p) => (
          <a
            key={p.id}
            href={`/panel/cuaderno/notas/${assignment.id}?periodo=${p.id}`}
            aria-current={p.id === period.id ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              p.id === period.id
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {p.name}
          </a>
        ))}
        <a
          href={`/panel/cuaderno/final/${assignment.id}`}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-100 hover:bg-brand-50"
        >
          Notas finales y recuperación
        </a>
      </nav>

      {!book.canEdit && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Solo lectura: las notas las pone quien da la clase (o su sustituto mientras dura la licencia).
        </p>
      )}

      <Gradebook owner={session.current.id} book={book} />
    </div>
  );
}
