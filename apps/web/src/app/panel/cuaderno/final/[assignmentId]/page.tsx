import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = { title: "Notas finales" };

/** Fin de año de una clase: promedio de los parciales, resultado y recuperación. */
export default async function FinalGradesPage({ params }: PageProps<"/panel/cuaderno/final/[assignmentId]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria");
  const { assignmentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) notFound();
  const notFoundOn = (err: unknown) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  };
  const book = await academic.gradebook(session.accessToken, assignmentId).catch(notFoundOn);
  const { assignment } = book;
  const finals = await academic.sectionFinals(session.accessToken, assignment.sectionId).catch(notFoundOn);
  const rows = finals.students.flatMap((s) => {
    const subject = s.subjects.find((x) => x.assignmentId === assignmentId);
    return subject ? [{ studentId: s.studentId, name: s.name, ...subject }] : [];
  });

  return (
    <div className="space-y-5">
      <div>
        <a
          href={`/panel/cuaderno/notas/${assignmentId}`}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Notas del parcial
        </a>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Notas finales · {assignment.subjectName} · {assignment.sectionLabel}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          La nota final es el promedio de los parciales. Quien no alcanza {finals.passingGrade} puede
          presentar recuperación: si en ella alcanza la nota mínima, aprueba la materia. Si falta algún
          parcial, el resultado queda «Incompleta».
        </p>
      </div>
      <RecoveryForm
        assignmentId={assignmentId}
        periods={finals.periods}
        rows={rows}
        passingGrade={finals.passingGrade}
        canEdit={book.canEdit}
      />
    </div>
  );
}
