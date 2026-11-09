import {
  type AttendanceSheetDto,
  currentPeriod,
  formatDay,
  type TeacherClassDto,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import { PrecacheClasses, SyncStatus } from "@/components/offline";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Mi cuaderno" };

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export default async function NotebookPage() {
  const session = await requireRole("docente", "admin", "coordinador");
  const token = session.accessToken;
  const today = todayInHonduras();

  const [classes, periodInfo] = await Promise.all([
    academic.teacherClasses(token),
    academic.periods(token).catch(() => null),
  ]);
  const period = periodInfo ? currentPeriod(periodInfo.periods, today) : null;

  // En básica un maestro suele dar todas las materias de su grado: se agrupa por sección.
  const bySection = new Map<string, { label: string; students: number; classes: TeacherClassDto[] }>();
  for (const c of classes) {
    const entry = bySection.get(c.assignment.sectionId) ?? {
      label: c.assignment.sectionLabel,
      students: c.students,
      classes: [],
    };
    entry.classes.push(c);
    bySection.set(c.assignment.sectionId, entry);
  }
  const sheets = new Map<string, AttendanceSheetDto | null>(
    await Promise.all(
      [...bySection.keys()].map(
        async (id) => [id, await academic.attendance(token, id).catch(() => null)] as const,
      ),
    ),
  );

  const notesUrl = (assignmentId: string) =>
    `/panel/cuaderno/notas/${assignmentId}${period ? `?periodo=${period.id}` : ""}`;
  const offlineUrls = [
    ...[...bySection.keys()].map((id) => `/panel/cuaderno/asistencia/${id}`),
    ...classes.map((c) => notesUrl(c.assignment.id)),
  ];
  const daysToClose = period ? daysBetween(today, period.closesOn) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Mi cuaderno</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hoy, {formatDay(today)}
            {period && (
              <>
                {" "}
                · {period.name} · cierre de notas {formatDay(period.closesOn)}
                {daysToClose !== null && daysToClose >= 0 && daysToClose <= 14 && (
                  <strong className={daysToClose <= 7 ? " text-amber-700" : ""}>
                    {" "}
                    (
                    {daysToClose === 0
                      ? "hoy"
                      : `faltan ${daysToClose} ${daysToClose === 1 ? "día" : "días"}`}
                    )
                  </strong>
                )}
              </>
            )}
          </p>
        </div>
        <div className="space-y-2">
          <SyncStatus />
          {classes.length > 0 && <PrecacheClasses urls={offlineUrls} />}
        </div>
      </div>

      {classes.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          No tienes clases asignadas en el año lectivo vigente. La dirección asigna las materias en
          «Estructura académica».
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...bySection.entries()].map(([sectionId, section]) => {
            const sheet = sheets.get(sectionId);
            const marked = sheet ? sheet.students.length - sheet.totals.sin_registro : 0;
            const taken =
              sheet !== null &&
              sheet !== undefined &&
              sheet.students.length > 0 &&
              marked === sheet.students.length;
            return (
              <section key={sectionId} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">{section.label}</h2>
                    <p className="text-xs text-slate-500">{section.students} alumnos</p>
                  </div>
                  {sheet && (
                    <a
                      href={`/panel/cuaderno/asistencia/${sectionId}`}
                      className={taken ? "btn-secondary px-3 py-1.5" : "btn-primary px-3 py-1.5"}
                    >
                      {taken
                        ? `Asistencia de hoy ✓ (${sheet.totals.ausente} ${sheet.totals.ausente === 1 ? "ausente" : "ausentes"})`
                        : marked > 0
                          ? `Terminar asistencia (${marked}/${sheet.students.length})`
                          : "Tomar asistencia de hoy"}
                    </a>
                  )}
                </div>
                <ul className="divide-y divide-slate-100">
                  {section.classes.map((c) => (
                    <li key={c.assignment.id}>
                      <a
                        href={notesUrl(c.assignment.id)}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-900">
                          {c.assignment.subjectName}
                          {c.substituting && (
                            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              Sustituyes a {c.assignment.teacherName}
                            </span>
                          )}
                        </span>
                        <span className="text-xs font-semibold text-brand-700">Notas →</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
