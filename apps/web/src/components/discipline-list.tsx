import {
  DISCIPLINE_LABELS,
  type DisciplineDto,
  type FamilyDisciplineDto,
  formatDay,
  SEVERITY_LABELS,
} from "@escolar/shared";
import Link from "next/link";
import { deleteDisciplineAction } from "@/app/panel/disciplina/actions";

const SEVERITY_TONE = {
  leve: "bg-slate-100 text-slate-700",
  grave: "bg-amber-50 text-amber-800",
  muy_grave: "bg-red-50 text-red-700",
} as const;

type Item = (DisciplineDto | FamilyDisciplineDto) & Partial<Pick<DisciplineDto, "studentName">>;

/**
 * Lista de llamados de atención y medidas. Con `showStudent`, cada uno dice de quién es (y enlaza a su
 * ficha si `linkStudents`); con `canDelete`, quien lo anotó o la dirección lo puede borrar.
 */
export function DisciplineList({
  items,
  showStudent = false,
  linkStudents = false,
  allowDelete = false,
}: {
  items: Item[];
  showStudent?: boolean;
  linkStudents?: boolean;
  allowDelete?: boolean;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((d) => {
        const full = "authorName" in d ? (d as DisciplineDto) : null;
        return (
          <li key={d.id} className="space-y-1 py-3 first:pt-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                {showStudent && full && (
                  <p className="text-sm font-semibold text-slate-900">
                    {linkStudents ? (
                      <Link href={`/panel/alumnos/${full.studentId}`} className="hover:underline">
                        {full.studentName}
                      </Link>
                    ) : (
                      full.studentName
                    )}
                    {full.sectionLabel && (
                      <span className="font-normal text-slate-500"> · {full.sectionLabel}</span>
                    )}
                  </p>
                )}
                <p className="text-sm font-semibold text-slate-900">
                  {DISCIPLINE_LABELS[d.kind]}{" "}
                  <span className="font-normal text-slate-500">· {formatDay(d.date)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_TONE[d.severity]}`}
                >
                  {SEVERITY_LABELS[d.severity]}
                </span>
                {full?.notifyFamily && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
                    Familia avisada
                  </span>
                )}
                {allowDelete && full?.canDelete && (
                  <form action={deleteDisciplineAction}>
                    <input type="hidden" name="id" value={full.id} />
                    <input type="hidden" name="studentId" value={full.studentId} />
                    <button type="submit" className="text-xs font-semibold text-slate-500 hover:text-red-700">
                      Borrar
                    </button>
                  </form>
                )}
              </div>
            </div>
            {d.kind === "suspension" && d.suspensionFrom && d.suspensionTo && (
              <p className="text-sm font-medium text-amber-800">
                Suspendido del {formatDay(d.suspensionFrom)} al {formatDay(d.suspensionTo)}
              </p>
            )}
            <p className="whitespace-pre-line text-sm text-slate-700">{d.description}</p>
            {d.measure && (
              <p className="whitespace-pre-line text-sm text-slate-600">
                <span className="font-semibold">Medida o acuerdo:</span> {d.measure}
              </p>
            )}
            {full && <p className="text-xs text-slate-500">Registró: {full.authorName}</p>}
          </li>
        );
      })}
    </ul>
  );
}
