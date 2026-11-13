import type { Metadata } from "next";
import Link from "next/link";
import { ScheduleGrid } from "@/components/schedule-grid";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { BlocksForm, SectionScheduleForm } from "./forms";

export const metadata: Metadata = { title: "Horario" };

export default async function SchedulePage({ searchParams }: PageProps<"/panel/horario">) {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const token = session.accessToken;
  const canEdit = session.user.role === "admin" || session.user.role === "coordinador";
  const { seccion } = await searchParams;

  // El docente ve su propio horario, en todas sus secciones.
  if (session.user.role === "docente") {
    const mine = await academic.mySchedule(token);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Mi horario</h1>
        <section className="card p-5">
          <ScheduleGrid schedule={mine} show="section" />
        </section>
      </div>
    );
  }

  const [sections, assignments] = await Promise.all([
    academic.listSections(token),
    academic.listAssignments(token),
  ]);
  const selected = sections.find((s) => s.id === seccion) ?? sections[0];
  const schedule = selected ? await academic.sectionSchedule(token, selected.id) : null;
  const classes = assignments
    .filter((a) => a.sectionId === selected?.id)
    .map((a) => ({ value: a.id, label: `${a.subjectName} · ${a.teacherName}` }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Horario de clases</h1>
        <p className="mt-1 text-sm text-slate-500">
          Las horas de clase del centro y qué clase va en cada día y hora de cada sección. Un docente no puede
          quedar en dos secciones a la misma hora.
        </p>
      </div>

      {sections.length === 0 ? (
        <p className="card p-6 text-sm text-slate-500">
          Primero crea las secciones y asigna los docentes en{" "}
          <Link href="/panel/estructura" className="text-brand-700 hover:underline">
            Estructura académica
          </Link>
          .
        </p>
      ) : (
        <div className={`grid gap-6 ${canEdit ? "lg:grid-cols-[1fr_24rem]" : ""}`}>
          <section className="card min-w-0 space-y-4 p-5">
            <nav aria-label="Secciones" className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <Link
                  key={s.id}
                  href={`/panel/horario?seccion=${s.id}`}
                  aria-current={s.id === selected?.id ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    s.id === selected?.id
                      ? "border-brand-500 bg-brand-50 font-semibold text-brand-800"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {s.label}
                </Link>
              ))}
            </nav>
            {selected && schedule && (
              <>
                <h2 className="font-semibold text-slate-900">{selected.label}</h2>
                {canEdit && schedule.blocks.length > 0 ? (
                  classes.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Esta sección todavía no tiene docentes asignados.
                    </p>
                  ) : (
                    <SectionScheduleForm
                      key={selected.id}
                      sectionId={selected.id}
                      schedule={schedule}
                      classes={classes}
                    />
                  )
                ) : (
                  <ScheduleGrid schedule={schedule} show="teacher" />
                )}
              </>
            )}
          </section>
          {canEdit && schedule && (
            <aside className="card h-fit p-5">
              <h2 className="mb-3 font-semibold text-slate-900">Horas de clase</h2>
              <BlocksForm blocks={schedule.blocks} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
