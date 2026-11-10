import {
  formatDay,
  formatNationalId,
  formatPhone,
  RELATIONSHIP_LABELS,
  SEX_LABELS,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { removeGuardianAction, setPrimaryGuardianAction } from "../actions";
import { PortalAccess } from "./portal-access";
import { AddGuardianForm, EnrollForm, StudentDataForm, TransferForm, WithdrawForm } from "./student-forms";

export const metadata: Metadata = { title: "Ficha del alumno" };

function ageFrom(birthDate: string | null): string | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = todayInHonduras().split("-").map(Number) as [number, number, number];
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return `${age} ${age === 1 ? "año" : "años"}`;
}

export default async function StudentPage({ params, searchParams }: PageProps<"/panel/alumnos/[id]">) {
  const session = await requireRole("admin", "secretaria", "coordinador");
  const canEdit = session.user.role !== "coordinador";
  const { id } = await params;
  const { nuevo } = await searchParams;

  const [student, years, sections] = await Promise.all([
    academic.getStudent(session.accessToken, id).catch((err) => {
      if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    }),
    academic.listYears(session.accessToken),
    academic.listSections(session.accessToken),
  ]);
  const currentYear = years.find((y) => y.isCurrent);
  const current = student.enrollments.find((e) => e.schoolYearId === currentYear?.id);
  const sectionOptions = sections
    .filter((s) => s.id !== current?.sectionId || current?.status !== "activa")
    .map((s) => {
      const full = s.capacity !== null && s.enrolledCount >= s.capacity;
      return {
        value: s.id,
        label: `${s.label} (${s.enrolledCount}${s.capacity !== null ? `/${s.capacity}` : ""})${full ? " — llena" : ""}`,
      };
    });
  const target = current ? { studentId: student.id, enrollmentId: current.id } : null;
  const age = ageFrom(student.birthDate);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/alumnos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Alumnos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">
            {student.firstNames} {student.lastNames}
          </h1>
          {current?.status === "activa" ? (
            <>
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-sm font-medium text-brand-700">
                {current.sectionLabel}
              </span>
              <Link href={`/panel/alumnos/${student.id}/boleta`} className="btn-secondary px-3 py-1 text-xs">
                Boleta
              </Link>
            </>
          ) : (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-sm font-medium text-amber-800">
              {current ? "Retirado este año" : "Sin matrícula este año"}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {[
            student.nationalId && `Identidad ${formatNationalId(student.nationalId)}`,
            age,
            student.sex && SEX_LABELS[student.sex],
          ]
            .filter(Boolean)
            .join(" · ") || "Sin datos de identidad"}
        </p>
      </div>

      {nuevo && (
        <div
          role="status"
          className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900"
        >
          Alumno registrado.
          {student.siblings.length > 0 &&
            ` Quedó en la misma familia que ${student.siblings.map((s) => s.fullName).join(", ")}.`}
        </div>
      )}

      {student.medicalNotes && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Salud:</strong> {student.medicalNotes}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Matrícula ${currentYear ? currentYear.name : ""}`}>
          {!currentYear ? (
            <p className="text-sm text-slate-500">No hay un año lectivo vigente configurado.</p>
          ) : current?.status === "activa" && target ? (
            <div className="space-y-5">
              <p className="text-sm text-slate-700">
                Matriculado en <strong>{current.sectionLabel}</strong> desde el{" "}
                {formatDay(current.enrolledOn)}.
              </p>
              {canEdit && (
                <>
                  <Collapsible summary="Cambiar de sección">
                    <TransferForm target={target} sections={sectionOptions} />
                  </Collapsible>
                  <Collapsible summary="Registrar retiro">
                    <WithdrawForm target={target} />
                  </Collapsible>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {current && (
                <p className="text-sm text-slate-600">
                  Retirado el {formatDay(current.withdrawnOn)}: {current.withdrawReason}
                </p>
              )}
              {canEdit &&
                (sectionOptions.length ? (
                  <EnrollForm studentId={student.id} sections={sectionOptions} />
                ) : (
                  <p className="text-sm text-slate-500">No hay secciones en el año vigente.</p>
                ))}
            </div>
          )}

          {student.enrollments.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Historial</h3>
              <ul className="space-y-1 text-sm">
                {student.enrollments.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.schoolYearName} · {e.sectionLabel}
                    </span>
                    <span className={e.status === "activa" ? "text-brand-700" : "text-slate-400"}>
                      {e.status === "activa" ? "Activa" : `Retirado el ${formatDay(e.withdrawnOn)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Responsables">
          <ul className="divide-y divide-slate-100">
            {student.guardians.map((g) => (
              <li key={g.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    {g.fullName}{" "}
                    <span className="font-normal text-slate-500">
                      · {RELATIONSHIP_LABELS[g.relationship]}
                    </span>
                    {g.isPrimary && (
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                        Principal
                      </span>
                    )}
                  </p>
                  {canEdit && !g.isPrimary && (
                    <div className="flex gap-3">
                      <form action={setPrimaryGuardianAction}>
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="guardianId" value={g.id} />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-brand-700 hover:underline"
                        >
                          Hacer principal
                        </button>
                      </form>
                      <form action={removeGuardianAction}>
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="guardianId" value={g.id} />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-slate-500 hover:text-red-700"
                        >
                          Quitar
                        </button>
                      </form>
                    </div>
                  )}
                </div>
                <p className="mt-0.5 text-sm tabular-nums text-slate-500">
                  {[g.phone && formatPhone(g.phone), g.email, g.nationalId && formatNationalId(g.nationalId)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {canEdit && (
                  <PortalAccess studentId={student.id} guardian={g} schoolName={session.school?.name ?? ""} />
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <Collapsible summary="Agregar otro responsable">
                <AddGuardianForm studentId={student.id} />
              </Collapsible>
            </div>
          )}
          {student.siblings.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
              <span className="text-slate-500">Hermanos en el colegio: </span>
              {student.siblings.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ", "}
                  <Link
                    href={`/panel/alumnos/${s.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {s.fullName}
                  </Link>
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {canEdit ? (
        <Card title="Datos del alumno">
          <StudentDataForm student={student} />
        </Card>
      ) : (
        student.notes && (
          <Card title="Observaciones">
            <p className="text-sm text-slate-700">{student.notes}</p>
          </Card>
        )
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Collapsible({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        {summary}
      </summary>
      <div className="border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}
