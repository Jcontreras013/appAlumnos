import type { ClassSummaryDto } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Aula virtual" };

/**
 * Aula virtual: las clases de quien entra. El maestro ve las que da (o cubre); el alumno, las de su
 * sección; la familia, las de cada hijo; la dirección y la secretaría pueden ver todas.
 */
export default async function ClassesPage({ searchParams }: PageProps<"/panel/aula">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria", "estudiante", "padre");
  const token = session.accessToken;
  const role = session.user.role;
  const params = await searchParams;
  const all = params.todas === "1" || role === "secretaria";

  if (role === "padre") {
    const children = await academic.familyChildren(token);
    const lists = await Promise.all(children.map((c) => academic.classes(token, { alumno: c.studentId })));
    return (
      <div className="space-y-8">
        <Title
          title="Clases de mis hijos"
          subtitle="Temas, materiales, avisos y la clase en línea de cada materia."
        />
        {children.length === 0 && <Empty>No hay hijos ligados a esta cuenta.</Empty>}
        {children.map((c, i) => (
          <section key={c.studentId} className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {c.name} <span className="text-sm font-normal text-slate-500">{c.sectionLabel ?? ""}</span>
            </h2>
            <ClassGrid classes={lists[i] ?? []} />
          </section>
        ))}
      </div>
    );
  }

  const classes = await academic.classes(token, { todas: all });
  const office = ["admin", "coordinador", "secretaria"].includes(role);
  const bySection = new Map<string, ClassSummaryDto[]>();
  for (const c of classes) bySection.set(c.sectionLabel, [...(bySection.get(c.sectionLabel) ?? []), c]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Title
          title={role === "estudiante" ? "Mis clases" : "Aula virtual"}
          subtitle={
            role === "estudiante"
              ? "Los temas, materiales y avisos de cada materia, y el enlace de la clase en línea."
              : "Cada clase tiene su página: temas con explicación, videos, guías, avisos y la clase en línea."
          }
        />
        {office && role !== "secretaria" && (
          <Link href={all ? "/panel/aula" : "/panel/aula?todas=1"} className="btn-secondary">
            {all ? "Solo mis clases" : "Ver todas las clases"}
          </Link>
        )}
      </div>
      {classes.length === 0 ? (
        <Empty>
          {role === "estudiante"
            ? "Todavía no tienes clases este año. Si crees que es un error, avisa en la secretaría."
            : all
              ? "Todavía no hay clases asignadas este año."
              : "No tienes clases asignadas este año."}
        </Empty>
      ) : all ? (
        [...bySection.entries()].map(([label, list]) => (
          <section key={label} className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">{label}</h2>
            <ClassGrid classes={list} />
          </section>
        ))
      ) : (
        <ClassGrid classes={classes} showSection={role !== "estudiante"} />
      )}
    </div>
  );
}

function ClassGrid({ classes, showSection = false }: { classes: ClassSummaryDto[]; showSection?: boolean }) {
  if (classes.length === 0) return <Empty>Sin clases.</Empty>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((c) => (
        <li key={c.assignmentId} className="card flex flex-col p-4">
          <Link href={`/panel/aula/${c.assignmentId}`} className="group flex-1">
            <p className="font-semibold text-slate-900 group-hover:underline">{c.subjectName}</p>
            <p className="text-sm text-slate-500">
              {showSection ? `${c.sectionLabel} · ` : ""}
              {c.teacherName}
              {c.substituting && " · sustitución"}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {c.topics === 0 ? "Sin temas todavía" : `${c.topics} ${c.topics === 1 ? "tema" : "temas"}`}
            </p>
          </Link>
          {c.meetingUrl && (
            <a
              href={c.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex w-fit items-center rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
            >
              Clase en línea{c.meetingNote ? ` · ${c.meetingNote}` : ""}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Title({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="card px-4 py-8 text-center text-sm text-slate-500">{children}</p>
);
