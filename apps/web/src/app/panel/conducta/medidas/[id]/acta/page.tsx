import {
  CONDUCT_ACTA_TITLES,
  CONDUCT_CATEGORY_LABELS,
  CONDUCT_SEVERITY_LABELS,
  type ConductActaDto,
  DIRECTOR_ONLY_MEASURES,
  formatLongDay,
  formatNationalId,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/print-button";
import { SchoolLogo } from "@/components/school-logo";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Acta de conducta" };

/** "López, Luis" => "Luis López". */
function naturalName(listName: string) {
  const [last, first] = listName.split(", ");
  return first ? `${first} ${last}` : listName;
}

/**
 * Qué dice el acta según la medida, antes de contar lo ocurrido. `who` es el nombre con su identidad y
 * sección entre comas (y cierra con coma si las lleva), así que aquí no va coma después de él.
 */
function opening({ incident, measure, guardianName }: ConductActaDto, who: ReactNode, school: string) {
  const happened = <strong>{formatLongDay(incident.date)}</strong>;
  const on = <strong>{formatLongDay(measure.startsOn)}</strong>;
  switch (measure.kind) {
    case "llamado_atencion":
      return (
        <>
          Se hace constar que el día {on} se le hizo un llamado de atención al estudiante {who} por lo
          ocurrido el día {happened}:
        </>
      );
    case "citacion_familia":
      return (
        <>
          Por medio de la presente se cita{" "}
          {guardianName ? (
            <>
              al señor(a) <strong>{guardianName}</strong>, padre, madre o encargado(a)
            </>
          ) : (
            "al padre, madre o encargado(a)"
          )}{" "}
          del estudiante {who} a presentarse en el centro educativo el día ____________________ a las
          __________, para tratar lo ocurrido el día {happened}:
        </>
      );
    case "compromiso":
      return (
        <>
          En el centro educativo <strong>{school}</strong>, el día {on}, el estudiante {who} y su padre, madre
          o encargado(a) se reúnen con las autoridades del centro por lo ocurrido el día {happened}:
        </>
      );
    case "suspension":
      return (
        <>
          Por medio de la presente se notifica que el estudiante {who} queda suspendido de clases del {on} al{" "}
          <strong>{formatLongDay(measure.endsOn ?? measure.startsOn)}</strong>, ambos días inclusive, por lo
          ocurrido el día {happened}:
        </>
      );
    case "expulsion":
      return (
        <>
          Por medio de la presente se notifica que el estudiante {who} queda expulsado del centro educativo y
          se retira su matrícula del año lectivo a partir del {on}, por lo ocurrido el día {happened}:
        </>
      );
  }
}

/**
 * Acta impresa de una medida de conducta (llamado, citación, compromiso, suspensión o expulsión), para
 * que el alumno y su familia la firmen y el centro la archive. El maestro solo imprime las de los
 * incidentes que él reportó.
 */
export default async function ConductActaPage({ params }: PageProps<"/panel/conducta/medidas/[id]/acta">) {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const acta = await academic.conductActa(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const { incident, measure, nationalId, guardianName } = acta;
  const school = session.school;
  const schoolName = school?.name ?? "";
  const isTeacher = session.user.role === "docente";
  const studentName = naturalName(incident.studentName);
  const who = (
    <>
      <strong>{studentName}</strong>
      {nationalId && (
        <>
          , con identidad <strong>{formatNationalId(nationalId)}</strong>
        </>
      )}
      {incident.sectionLabel && (
        <>
          , de <strong>{incident.sectionLabel}</strong>
        </>
      )}
      {(nationalId || incident.sectionLabel) && ","}
    </>
  );
  const signatures = [
    { line: "Estudiante", name: studentName },
    { line: "Padre, madre o encargado(a)", name: guardianName },
    { line: "Reportó", name: incident.reportedByName },
    {
      line: DIRECTOR_ONLY_MEASURES.includes(measure.kind) ? "Dirección" : "Dirección o coordinación",
      name: measure.decidedByName,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={isTeacher ? "/panel/conducta" : `/panel/alumnos/${incident.studentId}`}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          {isTeacher ? "← Conducta" : "← Ficha del alumno"}
        </Link>
        <PrintButton />
      </div>
      {measure.cancelledAt && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden">
          Esta medida fue anulada. El acta queda solo como consulta.
        </p>
      )}
      <article className="card mx-auto max-w-3xl space-y-6 p-8 text-slate-900 print:border-0 print:shadow-none sm:p-12">
        <header className="flex items-center gap-4 border-b border-slate-200 pb-4">
          {school && <SchoolLogo school={school} className="size-16" />}
          <div>
            <p className="text-lg font-semibold">{schoolName}</p>
            {school?.code && <p className="text-sm text-slate-600">Código del centro: {school.code}</p>}
          </div>
        </header>
        <h1 className="text-center text-xl font-bold uppercase tracking-wide">
          {CONDUCT_ACTA_TITLES[measure.kind]}
        </h1>
        <p className="text-justify leading-8">{opening(acta, who, schoolName)}</p>
        <blockquote className="whitespace-pre-line border-l-4 border-slate-300 pl-4 leading-7">
          {incident.description}
        </blockquote>
        <p className="text-sm">
          <span className="font-semibold">Falta:</span> {CONDUCT_CATEGORY_LABELS[incident.category]} ·{" "}
          <span className="font-semibold">Gravedad:</span> {CONDUCT_SEVERITY_LABELS[incident.severity]}
        </p>
        <div className="space-y-2">
          <p className="font-semibold">
            {measure.kind === "compromiso" ? "Acuerdos y compromisos:" : "Medida y acuerdos:"}
          </p>
          <p className="whitespace-pre-line leading-7">{measure.notes}</p>
          {measure.kind === "compromiso" && (
            <div className="space-y-6 pt-4" aria-hidden>
              <div className="border-b border-slate-400" />
              <div className="border-b border-slate-400" />
            </div>
          )}
        </div>
        <p className="text-justify leading-8">
          Firman de enterados en <strong>{schoolName}</strong>, el {formatLongDay(todayInHonduras())}.
        </p>
        <div className="grid grid-cols-2 gap-x-12 gap-y-16 pt-12 text-center text-sm">
          {signatures.map((s) => (
            <div key={s.line} className="border-t border-slate-400 pt-2">
              <p>{s.line}</p>
              {s.name && <p className="text-xs text-slate-600">{s.name}</p>}
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-slate-500">
          Sello del centro · La familia recibe una copia de esta acta.
        </p>
      </article>
    </div>
  );
}
