"use client";

import { formatNationalId, type StudentDetailDto } from "@escolar/shared";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AccessSheet } from "@/components/access-sheet";
import { Field, FormAlert } from "@/components/form-controls";
import { type StudentAccessState, studentAccessAction } from "../actions";

/**
 * La cuenta del alumno para el aula virtual: ve sus clases, entrega tareas y presenta exámenes.
 * Entra con su identidad (o su correo) y una contraseña temporal que cambia al entrar.
 */
export function StudentAccess({ student }: { student: StudentDetailDto }) {
  const [state, action] = useActionState<StudentAccessState, FormData>(studentAccessAction, {});
  const access = state.access;

  return (
    <div className="space-y-3">
      <FormAlert state={access ? {} : state} />
      {access &&
        (access.temporaryPassword ? (
          <div className="space-y-2">
            <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
              Cuenta lista. {access.studentName} entra con <strong>{access.login}</strong> y la contraseña
              temporal <strong className="font-mono">{access.temporaryPassword}</strong> (la cambia al
              entrar). No se vuelve a mostrar: imprímela o anótala ahora.
            </p>
            <AccessSheet
              title="Aula virtual"
              entries={[
                {
                  name: access.studentName,
                  detail: access.sectionLabel ?? "Alumno",
                  login: access.login,
                  password: access.temporaryPassword,
                },
              ]}
            />
          </div>
        ) : (
          <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
            {access.studentName} ya tenía cuenta: entra con <strong>{access.login}</strong> y su contraseña de
            siempre.
          </p>
        ))}

      {student.hasStudentAccess ? (
        <form action={action} className="flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="studentId" value={student.id} />
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            Tiene su cuenta
          </span>
          <IntentButton intent="restablecer" className="text-xs font-semibold text-brand-700 hover:underline">
            Nueva contraseña temporal
          </IntentButton>
          <IntentButton
            intent="quitar"
            className="text-xs font-semibold text-slate-500 hover:text-red-700"
            confirmText={`¿Quitar la cuenta de ${student.firstNames}? Ya no podrá entrar al aula virtual.`}
          >
            Quitar cuenta
          </IntentButton>
        </form>
      ) : (
        !access && (
          <form action={action} className="space-y-3" noValidate>
            <input type="hidden" name="studentId" value={student.id} />
            <p className="text-sm text-slate-600">
              Con su cuenta, el alumno ve sus clases, los temas y materiales, entrega tareas y presenta
              exámenes. Recomendado desde 7.º grado; en primaria la familia entrega por ellos.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                name="nationalId"
                label="Identidad del alumno"
                placeholder="0801-2011-05555"
                defaultValue={
                  state.values?.nationalId ?? (student.nationalId ? formatNationalId(student.nationalId) : "")
                }
                state={state}
              />
              <Field
                name="email"
                label="Correo (si no tiene identidad)"
                type="email"
                defaultValue={state.values?.email ?? student.email ?? ""}
                state={state}
              />
            </div>
            <IntentButton intent="dar" className="btn-primary px-3 py-1.5">
              Darle su cuenta
            </IntentButton>
          </form>
        )
      )}
    </div>
  );
}

function IntentButton({
  intent,
  className,
  confirmText,
  children,
}: {
  intent: string;
  className: string;
  confirmText?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
