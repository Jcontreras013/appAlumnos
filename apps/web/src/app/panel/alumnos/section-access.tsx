"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AccessSheet } from "@/components/access-sheet";
import { FormAlert } from "@/components/form-controls";
import { type SectionAccessState, sectionStudentAccessAction } from "./actions";

/** Cuentas del aula virtual para toda la sección de una vez, con la hoja para recortar y entregar. */
export function SectionAccess({ sectionId, sectionLabel }: { sectionId: string; sectionLabel: string }) {
  const [state, action] = useActionState<SectionAccessState, FormData>(sectionStudentAccessAction, {});
  const result = state.result;

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Aula virtual · {sectionLabel}</h2>
          <p className="text-xs text-slate-500">
            Da su cuenta a cada alumno de la sección que todavía no tiene. Entran con su identidad.
          </p>
        </div>
        {!result && (
          <form action={action}>
            <input type="hidden" name="sectionId" value={sectionId} />
            <SubmitButton />
          </form>
        )}
      </div>
      <FormAlert state={result ? {} : state} />
      {result && (
        <div className="space-y-3 text-sm">
          <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-brand-900">
            {result.created.length === 0
              ? "No había cuentas por crear."
              : `Se crearon ${result.created.length} ${result.created.length === 1 ? "cuenta" : "cuentas"}.`}
            {result.alreadyActive > 0 && ` ${result.alreadyActive} ya tenían la suya.`} Las contraseñas
            temporales no se vuelven a mostrar: imprime la hoja ahora.
          </p>
          {result.created.length > 0 && (
            <AccessSheet
              title="Aula virtual"
              entries={result.created.map((c) => ({
                name: c.studentName,
                detail: c.sectionLabel ?? sectionLabel,
                login: c.login,
                password: c.temporaryPassword,
              }))}
            />
          )}
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="font-medium">
                Sin identidad ni correo en su ficha (complétala y dale su cuenta):
              </p>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.map((s) => (
                  <li key={s.studentId}>
                    <Link href={`/panel/alumnos/${s.studentId}`} className="underline">
                      {s.studentName}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-secondary" disabled={pending}>
      {pending ? "Creando cuentas…" : "Dar cuentas a la sección"}
    </button>
  );
}
