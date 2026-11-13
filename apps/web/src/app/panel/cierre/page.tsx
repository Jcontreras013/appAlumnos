import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { copySectionsAction } from "./actions";
import { PromotionForm, type SectionPlan } from "./promotion-form";

export const metadata: Metadata = { title: "Cierre del año" };

/**
 * Cierre del año: el resultado de cada alumno según sus notas finales (y recuperaciones) y su paso al
 * año siguiente. La dirección decide los casos pendientes y confirma; nada se matricula antes.
 */
export default async function YearClosePage({ searchParams }: PageProps<"/panel/cierre">) {
  const session = await requireRole("admin");
  const token = session.accessToken;
  const { anio } = await searchParams;
  const [years, grades, sections] = await Promise.all([
    academic.listYears(token),
    academic.listGrades(token),
    academic.listSections(token),
  ]);
  const current = years.find((y) => y.isCurrent);
  const candidates = years.filter((y) => current && y.startsOn > current.startsOn);
  const next = candidates.find((y) => y.id === anio) ?? candidates[0];

  if (!current || !next) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Cierre del año</h1>
        <p className="card p-6 text-sm text-slate-700">
          Para pasar a los alumnos al año siguiente, primero crea el año lectivo siguiente y sus secciones en{" "}
          <Link href="/panel/estructura" className="font-semibold text-brand-700 hover:underline">
            Estructura académica
          </Link>
          . Mientras tanto, los docentes ya pueden registrar las recuperaciones desde «Notas finales y
          recuperación» en el cuaderno de cada clase.
        </p>
      </div>
    );
  }

  const [nextSections, finals] = await Promise.all([
    academic.listSections(token, next.id),
    Promise.all(sections.map((s) => academic.sectionFinals(token, s.id))),
  ]);
  const order = [...grades].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const nextGradeOf = (gradeId: string) => order[order.findIndex((g) => g.id === gradeId) + 1]?.id;
  const find = (gradeId: string | undefined, name: string) =>
    nextSections.find((s) => s.gradeId === gradeId && s.name === name)?.id ?? "";

  const plans: SectionPlan[] = sections.map((s, i) => ({
    id: s.id,
    label: s.label,
    // Por defecto: el grado siguiente con la misma letra; quienes repiten, el mismo grado.
    defaultPromotedTo: find(nextGradeOf(s.gradeId), s.name),
    defaultRepeatTo: find(s.gradeId, s.name),
    students: (finals[i]?.students ?? []).map((st) => ({
      studentId: st.studentId,
      name: st.name,
      proposal: st.proposal,
      failing: st.subjects.filter((x) => x.status === "reprobada").map((x) => x.subjectName),
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Cierre del año {current.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Según las notas finales y las recuperaciones, cada alumno queda promovido o repite el grado. Revisa,
          decide los casos pendientes y confirma: los alumnos quedan matriculados en {next.name}. El año
          vigente se cambia después en Estructura académica.
        </p>
        {candidates.length > 1 && (
          <nav className="mt-3 flex gap-2 text-sm">
            {candidates.map((y) => (
              <Link
                key={y.id}
                href={`/panel/cierre?anio=${y.id}`}
                className={
                  y.id === next.id ? "font-semibold text-brand-700" : "text-slate-600 hover:underline"
                }
              >
                Pasar a {y.name}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {nextSections.length === 0 ? (
        <div className="card space-y-3 p-6 text-sm text-slate-700">
          <p>El año {next.name} todavía no tiene secciones.</p>
          <form action={copySectionsAction}>
            <input type="hidden" name="toSchoolYearId" value={next.id} />
            <button type="submit" className="btn-primary">
              Crear en {next.name} las mismas secciones de {current.name}
            </button>
          </form>
          <p className="text-xs text-slate-500">
            Después puedes agregar o corregir secciones en Estructura académica.
          </p>
        </div>
      ) : (
        <PromotionForm
          toSchoolYearId={next.id}
          toSchoolYearName={next.name}
          sections={plans}
          nextSections={nextSections.map((s) => ({ value: s.id, label: s.label }))}
        />
      )}
    </div>
  );
}
