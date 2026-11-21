import {
  type FamilyChildDto,
  formatDay,
  formatNationalId,
  type SchoolDto,
  todayInHonduras,
} from "@escolar/shared";
import { SchoolLogo } from "@/components/school-logo";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

export type ReportCardLanguage = "es" | "en";

const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const formatDayEn = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS_EN[month - 1]} ${day}, ${year}`;
};

/** Textos de la boleta en cada idioma (colegios bilingües la entregan en inglés). */
const TEXT = {
  es: {
    title: "Boleta de calificaciones",
    year: (name: string) => `Año lectivo ${name} · Informativa`,
    student: "Alumno",
    section: "Grado y sección",
    notEnrolled: "Sin matrícula vigente",
    id: "Identidad",
    subject: "Asignatura",
    average: "Promedio",
    general: "Promedio general",
    inProgress: "En curso: proyección con lo evaluado hasta ahora",
    attendance: "Asistencia en el año",
    footer: (passing: number, date: string) =>
      `Nota mínima de aprobación: ${passing}. Entre paréntesis, la proyección del parcial en curso. Las calificaciones oficiales son las registradas por el centro en el SACE. Emitida el ${formatDay(date)}.`,
    teacher: "Docente",
    principal: "Dirección",
  },
  en: {
    title: "Report Card",
    year: (name: string) => `School year ${name} · Informational`,
    student: "Student",
    section: "Grade and section",
    notEnrolled: "Not currently enrolled",
    id: "ID number",
    subject: "Subject",
    average: "Average",
    general: "Overall average",
    inProgress: "In progress: projection with what has been graded so far",
    attendance: "Attendance this school year",
    footer: (passing: number, date: string) =>
      `Passing grade: ${passing}. In parentheses, the projection for the current term. Official grades are those recorded by the school in SACE. Issued on ${formatDayEn(date)}.`,
    teacher: "Teacher",
    principal: "Principal",
  },
} satisfies Record<ReportCardLanguage, Record<string, unknown>>;

/**
 * Boleta de calificaciones informativa: lo mismo que ve la familia, en una hoja para imprimir o
 * guardar en PDF. Las notas oficiales son las que el centro registra en el SACE.
 */
export function ReportCard({
  child,
  school,
  language = "es",
}: {
  child: FamilyChildDto;
  school: Pick<SchoolDto, "id" | "name" | "logoVersion"> | null;
  language?: ReportCardLanguage;
}) {
  const { student, periods, subjects, passingGrade } = child;
  const t = TEXT[language];
  return (
    <article className="card mx-auto max-w-4xl space-y-6 p-6 print:border-0 print:shadow-none sm:p-8">
      <header className="flex items-center gap-4 border-b border-slate-200 pb-4">
        {school && <SchoolLogo school={school} className="size-16" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{school?.name}</p>
          <h1 className="text-xl font-semibold text-slate-900">{t.title}</h1>
          <p className="text-xs text-slate-500">{t.year(student.schoolYearName ?? "—")}</p>
        </div>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{t.student}</dt>
          <dd className="font-semibold text-slate-900">{student.name}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{t.section}</dt>
          <dd className="font-medium text-slate-900">{student.sectionLabel ?? t.notEnrolled}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{t.id}</dt>
          <dd className="font-medium tabular-nums text-slate-900">{formatNationalId(student.nationalId)}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-semibold">{t.subject}</th>
              {periods.map((p) => (
                <th key={p.id} className="px-2 py-2 text-center font-semibold">
                  {p.name.replace(" Parcial", "")}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold">{t.average}</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.assignmentId} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <span className="font-medium text-slate-900">{s.subjectName}</span>
                  <span className="block text-xs text-slate-500">{s.teacherName}</span>
                </td>
                {periods.map((p) => {
                  const g = s.grades[p.id];
                  return (
                    <td key={p.id} className="px-2 py-2 text-center tabular-nums">
                      {g?.grade !== null && g?.grade !== undefined ? (
                        <span
                          className={g.grade < passingGrade ? "font-semibold text-red-700" : "text-slate-900"}
                        >
                          {g.grade}
                        </span>
                      ) : g?.projected !== null && g?.projected !== undefined ? (
                        <span className="text-slate-400" title={t.inProgress}>
                          ({g.projected})
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center font-semibold tabular-nums">
                  {s.average ?? <span className="font-normal text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td className="py-2 pr-3 font-semibold text-slate-900" colSpan={periods.length + 1}>
                {t.general}
              </td>
              <td className="px-2 py-2 text-center text-base font-bold tabular-nums">
                {child.generalAverage ?? "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-sm text-slate-700">
        {t.attendance}: <strong>{pct(child.attendance.yearRate)}</strong>
      </p>

      <footer className="space-y-6 text-xs text-slate-500">
        <p>{t.footer(passingGrade, todayInHonduras())}</p>
        <div className="grid grid-cols-2 gap-10 pt-8 text-center">
          <p className="border-t border-slate-400 pt-1">{t.teacher}</p>
          <p className="border-t border-slate-400 pt-1">{t.principal}</p>
        </div>
      </footer>
    </article>
  );
}
