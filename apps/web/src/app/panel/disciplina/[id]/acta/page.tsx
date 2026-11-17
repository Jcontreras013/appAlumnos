import {
  ACTA_TITLES,
  type DisciplineDto,
  formatLongDay,
  formatNationalId,
  SEVERITY_LABELS,
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

export const metadata: Metadata = { title: "Acta de disciplina" };

/** "López, Luis" => "Luis López". */
function naturalName(listName: string) {
  const [last, first] = listName.split(", ");
  return first ? `${first} ${last}` : listName;
}

/**
 * Qué dice el acta según la medida, antes de contar lo ocurrido. `who` es el nombre con su identidad y
 * sección entre comas (y cierra con coma si las lleva), así que aquí no va coma después de él.
 */
function opening(r: DisciplineDto, who: ReactNode, guardianName: string | null, school: string) {
  const day = <strong>{formatLongDay(r.date)}</strong>;
  switch (r.kind) {
    case "llamado_verbal":
      return (
        <>
          Se hace constar que el día {day} se le hizo un llamado de atención verbal al estudiante {who} por lo
          siguiente:
        </>
      );
    case "llamado_escrito":
      return (
        <>
          Por medio de la presente se le hace un llamado de atención por escrito al estudiante {who} por lo
          ocurrido el día {day}:
        </>
      );
    case "citacion":
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
          __________, para tratar lo ocurrido el día {day}:
        </>
      );
    case "compromiso":
      return (
        <>
          En el centro educativo <strong>{school}</strong>, el estudiante {who} y su padre, madre o
          encargado(a) se reúnen con las autoridades del centro por lo ocurrido el día {day}:
        </>
      );
    case "suspension":
      return (
        <>
          Por medio de la presente se notifica que el estudiante {who} queda suspendido de clases del{" "}
          <strong>{formatLongDay(r.suspensionFrom ?? r.date)}</strong> al{" "}
          <strong>{formatLongDay(r.suspensionTo ?? r.date)}</strong>, ambos días inclusive, por lo ocurrido el
          día {day}:
        </>
      );
    case "expulsion":
      return (
        <>
          Por medio de la presente se notifica que el estudiante {who} queda expulsado del centro educativo y
          se retira su matrícula del año lectivo, por lo ocurrido el día {day}:
        </>
      );
  }
}

/**
 * Acta impresa de un llamado de atención o una medida disciplinaria, para que el alumno y su familia la
 * firmen y el centro la archive. El docente solo imprime las de sus alumnos.
 */
export default async function DisciplineActaPage({ params }: PageProps<"/panel/disciplina/[id]/acta">) {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const {
    record: r,
    nationalId,
    guardianName,
  } = await academic.disciplineActa(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const school = session.school;
  const schoolName = school?.name ?? "";
  const isTeacher = session.user.role === "docente";
  const byDirection = r.kind === "suspension" || r.kind === "expulsion";
  const who = (
    <>
      <strong>{naturalName(r.studentName)}</strong>
      {nationalId && (
        <>
          , con identidad <strong>{formatNationalId(nationalId)}</strong>
        </>
      )}
      {r.sectionLabel && (
        <>
          , de <strong>{r.sectionLabel}</strong>
        </>
      )}
      {(nationalId || r.sectionLabel) && ","}
    </>
  );
  const signatures = [
    { line: "Estudiante", name: naturalName(r.studentName) },
    { line: "Padre, madre o encargado(a)", name: guardianName },
    ...(byDirection ? [] : [{ line: "Registró", name: r.authorName }]),
    { line: "Dirección", name: byDirection ? r.authorName : null },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={isTeacher ? "/panel/disciplina" : `/panel/alumnos/${r.studentId}`}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          {isTeacher ? "← Disciplina" : "← Ficha del alumno"}
        </Link>
        <PrintButton />
      </div>
      <article className="card mx-auto max-w-3xl space-y-6 p-8 text-slate-900 print:border-0 print:shadow-none sm:p-12">
        <header className="flex items-center gap-4 border-b border-slate-200 pb-4">
          {school && <SchoolLogo school={school} className="size-16" />}
          <div>
            <p className="text-lg font-semibold">{schoolName}</p>
            {school?.code && <p className="text-sm text-slate-600">Código del centro: {school.code}</p>}
          </div>
        </header>
        <h1 className="text-center text-xl font-bold uppercase tracking-wide">{ACTA_TITLES[r.kind]}</h1>
        <p className="text-justify leading-8">{opening(r, who, guardianName, schoolName)}</p>
        <blockquote className="whitespace-pre-line border-l-4 border-slate-300 pl-4 leading-7">
          {r.description}
        </blockquote>
        <p className="text-sm">
          <span className="font-semibold">Gravedad:</span> {SEVERITY_LABELS[r.severity]}
        </p>
        {r.kind === "compromiso" || r.measure ? (
          <div className="space-y-2">
            <p className="font-semibold">
              {r.kind === "compromiso" ? "Acuerdos y compromisos:" : "Medida o acuerdo:"}
            </p>
            {r.measure ? (
              <p className="whitespace-pre-line leading-7">{r.measure}</p>
            ) : (
              <div className="space-y-6 pt-4" aria-hidden>
                <div className="border-b border-slate-400" />
                <div className="border-b border-slate-400" />
                <div className="border-b border-slate-400" />
              </div>
            )}
          </div>
        ) : null}
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
