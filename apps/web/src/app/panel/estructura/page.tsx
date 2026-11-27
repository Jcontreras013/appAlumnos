import { describeClassDays, formatDay } from "@escolar/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fold, FoldTag } from "@/components/fold";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { setCurrentYearAction } from "./actions";
import { AssignmentEditor, GradeEditor, SectionEditor, ShiftEditor, SubjectEditor } from "./editors";
import {
  AssignmentForm,
  GradeForm,
  PassingGradeForm,
  PeriodsForm,
  SectionForm,
  ShiftForm,
  SubjectForm,
  YearForm,
} from "./forms";

export const metadata: Metadata = { title: "Año, grados y materias" };

export default async function StructurePage() {
  const session = await requireRole("admin", "coordinador", "secretaria");
  const token = session.accessToken;
  const canEdit = session.user.role !== "secretaria";
  // La secretaría pide grados, secciones y materias; la dirección los confirma.
  const requests = session.user.role === "secretaria";

  const isDirector = session.user.role === "admin";
  const [years, grades, sections, subjects, assignments, staff, evaluation, shiftList] = await Promise.all([
    academic.listYears(token),
    academic.listGrades(token),
    academic.listSections(token),
    academic.listSubjects(token),
    academic.listAssignments(token),
    canEdit ? identity.listUsers(token) : Promise.resolve([]),
    academic.periods(token).catch(() => null),
    academic.listShifts(token).catch(() => []),
  ]);
  const shiftOptions = shiftList.map((s) => ({
    value: s.id,
    label: `${s.name} (${describeClassDays(s.classDays)})`,
  }));
  const current = years.find((y) => y.isCurrent);
  const teachers = staff
    .filter((u) => u.active && (u.role === "docente" || u.role === "coordinador"))
    .map((u) => ({ value: u.id, label: u.name }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Año, grados y materias</h1>
        <p className="mt-1 text-sm text-slate-500">
          {current
            ? `Año lectivo vigente: ${current.name}. Las secciones y docentes de abajo son de ese año.`
            : "Empieza creando el año lectivo; el primero que crees queda como vigente."}
        </p>
      </div>

      <Block
        title="Años lectivos"
        count={`${years.length} ${years.length === 1 ? "año" : "años"}`}
        aside={canEdit && <YearForm />}
      >
        {years.length === 0 ? (
          <Empty>Todavía no hay años lectivos.</Empty>
        ) : (
          <Table head={["Año", "Del", "Al", ""]}>
            {years.map((y) => (
              <tr key={y.id}>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {y.name}
                  {y.isCurrent && <Badge>Vigente</Badge>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(y.startsOn)}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(y.endsOn)}</td>
                <td className="px-4 py-3 text-right">
                  {canEdit && !y.isCurrent && (
                    <form action={setCurrentYearAction}>
                      <input type="hidden" name="id" value={y.id} />
                      <button type="submit" className="text-xs font-semibold text-brand-700 hover:underline">
                        Marcar como vigente
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Block>

      {current && evaluation && (
        <Block
          title={`Parciales ${current.name} y nota mínima`}
          count={`${evaluation.periods.length} parciales · mínima ${evaluation.passingGrade}`}
          aside={canEdit && <PassingGradeForm passingGrade={evaluation.passingGrade} />}
        >
          {canEdit ? (
            <div className="p-4">
              <PeriodsForm
                key={evaluation.periods.map((p) => p.id + p.closesOn).join()}
                periods={evaluation.periods}
                year={current}
              />
            </div>
          ) : (
            <Table head={["Parcial", "Del", "Al", "Cierre de notas"]}>
              {evaluation.periods.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {p.name}
                    {p.id === evaluation.current && <Badge>Vigente</Badge>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(p.startsOn)}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(p.endsOn)}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(p.closesOn)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Block>
      )}

      <Block
        title="Jornadas"
        count={
          shiftList.length
            ? `${shiftList.length} ${shiftList.length === 1 ? "jornada" : "jornadas"}`
            : "Una sola (lunes a viernes)"
        }
        aside={isDirector && <ShiftForm />}
      >
        {shiftList.length === 0 ? (
          <Empty>
            Todas las secciones trabajan de lunes a viernes. Si el centro tiene jornada nocturna, de fin de
            semana o dominical, agrégala aquí y elige la jornada de cada sección: el horario, la
            planificación, la asistencia y los avisos se ajustan a sus días.
          </Empty>
        ) : (
          <Table head={["Jornada", "Días de clase", "Secciones este año", ""]}>
            {shiftList.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3">{describeClassDays(s.classDays)}</td>
                <td className="px-4 py-3 tabular-nums">{s.sections}</td>
                <td className="px-4 py-3 text-right">{isDirector && <ShiftEditor shift={s} />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Block>

      <Block
        title="Grados y secciones"
        count={`${grades.length} ${grades.length === 1 ? "grado" : "grados"} · ${sections.length} ${sections.length === 1 ? "sección" : "secciones"}`}
        aside={
          (canEdit || requests) && (
            <div className="space-y-6">
              <GradeForm request={requests} />
              {current && grades.length > 0 && (
                <div className="border-t border-slate-200 pt-5">
                  <SectionForm
                    request={requests}
                    schoolYearId={current.id}
                    grades={grades.map((g) => ({ value: g.id, label: g.name }))}
                    years={years
                      .filter((y) => y.startsOn >= current.startsOn)
                      .map((y) => ({ value: y.id, label: y.name }))}
                    shifts={shiftOptions}
                  />
                </div>
              )}
            </div>
          )
        }
      >
        {grades.length === 0 ? (
          <Empty>Agrega los grados que ofrece el centro (por ejemplo, Kínder, Primer grado…).</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {grades.map((g) => {
              const own = sections.filter((s) => s.gradeId === g.id);
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="min-w-36 font-medium text-slate-900">{g.name}</span>
                  {canEdit && (
                    <span className="mr-2">
                      <GradeEditor grade={g} />
                    </span>
                  )}
                  {own.length === 0 && <span className="text-sm text-slate-400">Sin secciones este año</span>}
                  {own.map((s) => {
                    const full = s.capacity !== null && s.enrolledCount >= s.capacity;
                    return (
                      <span
                        key={s.id}
                        className={`inline-flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1 text-sm tabular-nums ${
                          full
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-slate-50"
                        }`}
                        title={full ? "Sección llena" : undefined}
                      >
                        <span>
                          <strong className="font-semibold">{s.name}</strong> · {s.enrolledCount}
                          {s.capacity !== null ? `/${s.capacity}` : ""} alumnos
                          {s.shiftName && <span className="text-xs text-slate-500"> · {s.shiftName}</span>}
                        </span>
                        {canEdit && <SectionEditor section={s} shifts={shiftOptions} />}
                      </span>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block
        title="Materias y docentes"
        count={`${subjects.length} ${subjects.length === 1 ? "materia" : "materias"} · ${assignments.length} ${assignments.length === 1 ? "clase" : "clases"}`}
        aside={
          (canEdit || requests) && (
            <div className="space-y-6">
              <SubjectForm request={requests} />
              {canEdit && sections.length > 0 && subjects.length > 0 && (
                <div className="border-t border-slate-200 pt-5">
                  <AssignmentForm
                    sections={sections.map((s) => ({ value: s.id, label: s.label }))}
                    subjects={subjects.map((s) => ({ value: s.id, label: s.name }))}
                    teachers={teachers}
                  />
                </div>
              )}
            </div>
          )
        }
      >
        {subjects.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
            {subjects.map((s) => (
              <span
                key={s.id}
                className="inline-flex flex-wrap items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-700"
              >
                {s.name}
                {s.language === "en" && (
                  <span className="rounded-full bg-blue-100 px-1.5 text-xs font-semibold text-blue-800">
                    Inglés
                  </span>
                )}
                {canEdit && <SubjectEditor subject={s} />}
              </span>
            ))}
          </div>
        )}
        {assignments.length === 0 ? (
          <Empty>
            Asigna qué docente da cada materia en cada sección. Lo usará la planificación semanal.
          </Empty>
        ) : (
          <Table head={["Sección", "Materia", "Docente", ""]}>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3">{a.sectionLabel}</td>
                <td className="px-4 py-3">{a.subjectName}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{a.teacherName}</td>
                <td className="px-4 py-3 text-right">
                  {canEdit && (
                    <AssignmentEditor
                      assignment={a}
                      teachers={
                        teachers.some((t) => t.value === a.teacherUserId)
                          ? teachers
                          : [{ value: a.teacherUserId, label: `${a.teacherName} (inactivo)` }, ...teachers]
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
    </div>
  );
}

/** Cada tabla en un desplegable con cuántos hay, para que la pantalla no se sature. */
function Block({
  title,
  count,
  children,
  aside,
}: {
  title: string;
  count: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className={`grid items-start gap-6 ${aside ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
      <Fold title={title} summary={<FoldTag>{count}</FoldTag>}>
        {children}
      </Fold>
      {aside && <div className="card h-fit p-5">{aside}</div>}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-6 text-center text-sm text-slate-500">{children}</p>
);

const Badge = ({ children }: { children: ReactNode }) => (
  <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
    {children}
  </span>
);
