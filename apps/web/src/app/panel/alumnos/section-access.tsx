"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AccessSheet } from "@/components/access-sheet";
import { FormAlert } from "@/components/form-controls";
import {
  type SectionAccessState,
  type SectionFamilyState,
  sectionFamilyAccessAction,
  sectionStudentAccessAction,
} from "./actions";

/**
 * Cuentas para toda la sección de una vez: el portal de las familias y el aula virtual de los
 * alumnos, cada una con su hoja para imprimir, recortar y entregar (por ejemplo, en la reunión de
 * padres). Solo se crean las que faltan: se puede volver a tocar después de completar fichas.
 */
export function SectionAccess({ sectionId, sectionLabel }: { sectionId: string; sectionLabel: string }) {
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Cuentas de la sección · {sectionLabel}</h2>
        <p className="text-xs text-slate-500">
          Crea de una vez las cuentas que faltan e imprime una hoja con el usuario y la contraseña temporal de
          cada uno. Entran con su número de identidad y al entrar eligen su propia contraseña.
        </p>
      </div>
      <FamiliesBlock sectionId={sectionId} />
      <div className="border-t border-slate-100" />
      <StudentsBlock sectionId={sectionId} sectionLabel={sectionLabel} />
    </section>
  );
}

function FamiliesBlock({ sectionId }: { sectionId: string }) {
  const [state, action] = useActionState<SectionFamilyState, FormData>(sectionFamilyAccessAction, {});
  const result = state.result;
  const fresh = result?.created.filter((c) => c.temporaryPassword) ?? [];
  const linked = result ? result.created.length - fresh.length : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-900">Portal de familias</h3>
          <p className="text-xs text-slate-500">
            Notas, asistencia, tareas y pagos de sus hijos. Un encargado con varios hijos recibe una sola
            cuenta.
          </p>
        </div>
        {!result && (
          <form action={action} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="sectionId" value={sectionId} />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="allGuardians" value="si" className="rounded border-slate-300" />
              También a los demás encargados (no solo al principal)
            </label>
            <SubmitButton idle="Dar acceso a las familias" busy="Creando accesos…" />
          </form>
        )}
      </div>
      <FormAlert state={result ? {} : state} />
      {result && (
        <div className="space-y-3 text-sm">
          {result.interrupted && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
              Se detuvo a medias: {result.interrupted} Lo que se creó hasta ahí sí quedó; imprime la hoja y
              vuelve a tocar el botón más tarde para las que faltan.
            </p>
          )}
          <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-brand-900">
            {fresh.length === 0
              ? "No había accesos nuevos por crear."
              : `Se crearon ${fresh.length} ${fresh.length === 1 ? "acceso" : "accesos"}.`}
            {linked > 0 &&
              ` ${linked} ya tenían cuenta en CONECTA (por otro centro): entran con su contraseña de siempre.`}
            {result.alreadyActive > 0 &&
              ` ${result.alreadyActive} ya ${result.alreadyActive === 1 ? "tenía" : "tenían"} acceso.`}
            {fresh.length > 0 &&
              " Las contraseñas temporales no se vuelven a mostrar: imprime la hoja ahora."}
          </p>
          {result.created.length > 0 && (
            <AccessSheet
              title="Portal de familias"
              entries={result.created.map((c) => ({
                name: c.guardianName,
                detail: `Responsable de ${c.children.join(", ")}`,
                login: c.login,
                password: c.temporaryPassword,
              }))}
            />
          )}
          <SkippedList
            title="No se pudo (completa la ficha y vuelve a tocar el botón):"
            items={result.skipped.map((s) => ({
              key: `${s.studentId}-${s.guardianName ?? ""}`,
              studentId: s.studentId,
              text: s.guardianName
                ? `${s.guardianName} (de ${s.studentName}): ${s.reason}`
                : `${s.studentName}: ${s.reason}`,
            }))}
          />
        </div>
      )}
    </div>
  );
}

function StudentsBlock({ sectionId, sectionLabel }: { sectionId: string; sectionLabel: string }) {
  const [state, action] = useActionState<SectionAccessState, FormData>(sectionStudentAccessAction, {});
  const result = state.result;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-900">Aula virtual de los alumnos</h3>
          <p className="text-xs text-slate-500">
            Sus clases, tareas y exámenes. Recomendado desde 7.º grado; en primaria la familia entrega por
            ellos.
          </p>
        </div>
        {!result && (
          <form action={action}>
            <input type="hidden" name="sectionId" value={sectionId} />
            <SubmitButton idle="Dar cuentas a los alumnos" busy="Creando cuentas…" />
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
            {result.alreadyActive > 0 &&
              ` ${result.alreadyActive} ya ${result.alreadyActive === 1 ? "tenía" : "tenían"} la suya.`}{" "}
            Las contraseñas temporales no se vuelven a mostrar: imprime la hoja ahora.
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
          <SkippedList
            title="Sin identidad ni correo en su ficha (complétala y dale su cuenta):"
            items={result.skipped.map((s) => ({
              key: s.studentId,
              studentId: s.studentId,
              text: s.studentName,
            }))}
          />
        </div>
      )}
    </div>
  );
}

function SkippedList({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; studentId: string; text: string }>;
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc pl-5">
        {items.map((s) => (
          <li key={s.key}>
            <Link href={`/panel/alumnos/${s.studentId}`} className="underline">
              {s.text}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-secondary" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}
