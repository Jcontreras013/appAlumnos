import type { Metadata } from "next";
import { DisciplineList } from "@/components/discipline-list";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { DisciplineForm } from "./discipline-form";

export const metadata: Metadata = { title: "Disciplina" };

export default async function DisciplinePage() {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const overview = await academic.disciplineOverview(session.accessToken);
  const isTeacher = session.user.role === "docente";
  const canRegister = overview.kinds.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Disciplina</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          {isTeacher
            ? "Llamados de atención y citaciones de tus alumnos. La suspensión y la expulsión las registra la dirección."
            : "Llamados de atención, citaciones, actas de compromiso, suspensiones y expulsiones del centro."}
        </p>
      </div>

      {overview.activeSuspensions.length > 0 && (
        <section className="card border-amber-200 p-5">
          <h2 className="mb-3 font-semibold text-amber-900">
            Suspendidos hoy ({overview.activeSuspensions.length})
          </h2>
          <DisciplineList items={overview.activeSuspensions} showStudent linkStudents={!isTeacher} />
        </section>
      )}

      <div className={`grid gap-6 ${canRegister ? "lg:grid-cols-[1fr_24rem]" : ""}`}>
        <section className="card min-w-0 p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Últimos 4 meses</h2>
          {overview.recent.length === 0 ? (
            <p className="text-sm text-slate-500">
              {isTeacher && overview.students.length === 0
                ? "Todavía no tienes clases asignadas este año."
                : "No hay llamados de atención ni medidas registradas."}
            </p>
          ) : (
            <DisciplineList
              items={overview.recent}
              showStudent
              linkStudents={!isTeacher}
              allowDelete={canRegister}
            />
          )}
        </section>
        {canRegister && (
          <aside className="card h-fit p-5">
            <h2 className="mb-4 font-semibold text-slate-900">Registrar</h2>
            {overview.students.length === 0 ? (
              <p className="text-sm text-slate-500">No hay alumnos matriculados en tus secciones.</p>
            ) : (
              <DisciplineForm students={overview.students} kinds={overview.kinds} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
