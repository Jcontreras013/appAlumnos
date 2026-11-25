import type { Metadata } from "next";
import { ChildOverview } from "@/components/child-overview";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Mis notas" };

/** El alumno ve sus notas, asistencia, tareas de la semana y horario: lo mismo que su familia. */
export default async function MyGradesPage() {
  const session = await requireRole("estudiante");
  const [child, schedule] = await Promise.all([
    academic.studentMe(session.accessToken).catch((err) => {
      if (err instanceof ServiceError && err.status === 404) return null;
      throw err;
    }),
    academic.studentSchedule(session.accessToken).catch(() => null),
  ]);
  if (!child) {
    return (
      <div className="card max-w-xl p-6 text-sm text-slate-600">
        Tu cuenta todavía no está ligada a tu ficha de alumno. Pide ayuda en la secretaría del centro.
      </div>
    );
  }
  const { student, period } = child;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Mis notas</h1>
        <p className="text-sm text-slate-500">
          {student.sectionLabel ?? "Sin matrícula vigente"} · Año {student.schoolYearName ?? "—"}
          {period && ` · ${period.name}`}
        </p>
      </div>
      <ChildOverview child={child} schedule={schedule} viewer="alumno" />
    </div>
  );
}
