import { formatDay, formatNationalId, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Constancia de matrícula" };

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * Constancia de matrícula para imprimir, firmar y sellar: la piden las familias para becas, bonos,
 * trámites de salud o un traslado. Sale con los datos de la matrícula vigente del alumno.
 */
export default async function EnrollmentCertificatePage({
  params,
}: PageProps<"/panel/alumnos/[id]/constancia">) {
  const session = await requireRole("admin", "secretaria");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const student = await academic.getStudent(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const enrollment = student.enrollments.find((e) => e.status === "activa");
  const school = session.school;
  const today = todayInHonduras();
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const name = `${student.firstNames} ${student.lastNames}`;
  const enrolled =
    student.sex === "F" ? "matriculada" : student.sex === "M" ? "matriculado" : "matriculado(a)";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/panel/alumnos/${id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← Ficha del alumno
        </Link>
        {enrollment && <PrintButton />}
      </div>
      {!enrollment ? (
        <p role="alert" className="card p-6 text-sm text-slate-700">
          {name} no tiene una matrícula vigente: no se puede extender la constancia. Matricúlalo primero desde
          su ficha.
        </p>
      ) : (
        <article className="card mx-auto max-w-3xl space-y-8 p-8 text-slate-900 print:border-0 print:shadow-none sm:p-12">
          <header className="flex items-center gap-4 border-b border-slate-200 pb-4">
            {school && <SchoolLogo school={school} className="size-16" />}
            <div>
              <p className="text-lg font-semibold">{school?.name}</p>
              {school?.code && <p className="text-sm text-slate-600">Código del centro: {school.code}</p>}
            </div>
          </header>
          <h1 className="text-center text-xl font-bold uppercase tracking-wide">Constancia de matrícula</h1>
          <p className="text-justify leading-8">
            La Dirección del centro educativo <strong>{school?.name}</strong> hace constar que{" "}
            <strong>{name}</strong>
            {student.nationalId && (
              <>
                , con número de identidad <strong>{formatNationalId(student.nationalId)}</strong>
              </>
            )}
            , está {enrolled} en <strong>{enrollment.sectionLabel}</strong> en el año lectivo{" "}
            <strong>{enrollment.schoolYearName}</strong>, desde el {formatDay(enrollment.enrolledOn)}.
          </p>
          <p className="text-justify leading-8">
            Y para los fines que a la persona interesada convengan, se extiende la presente a los {day} días
            del mes de {MONTHS[month - 1]} de {year}.
          </p>
          <div className="grid grid-cols-2 gap-12 pt-16 text-center text-sm">
            <div className="border-t border-slate-400 pt-2">Director(a)</div>
            <div className="border-t border-slate-400 pt-2">Secretario(a)</div>
          </div>
          <p className="text-center text-xs text-slate-500">Sello del centro</p>
        </article>
      )}
    </div>
  );
}
