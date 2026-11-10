"use client";

import { formatNationalId, type GuardianLinkDto, type PortalAccessDto } from "@escolar/shared";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field, FormAlert } from "@/components/form-controls";
import { type PortalAccessState, portalAccessAction } from "../actions";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** Carta para entregar en papel (o fotografiar y mandar por WhatsApp) con los datos de acceso. */
function printLetter(access: PortalAccessDto, schoolName: string) {
  const site = window.location.origin;
  const win = window.open("", "_blank", "width=720,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acceso al portal de familias</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 24px;color:#0f172a;line-height:1.5}
h1{font-size:20px;margin:0 0 4px}.muted{color:#475569}.box{border:2px dashed #94a3b8;border-radius:12px;padding:16px 20px;margin:20px 0}
.big{font-size:20px;font-weight:700;font-family:ui-monospace,monospace;letter-spacing:.5px}ol{padding-left:20px}</style></head>
<body><p class="muted">${escapeHtml(schoolName)}</p><h1>Portal de familias</h1>
<p>Estimado(a) <strong>${escapeHtml(access.guardianName)}</strong>: desde ahora puede ver las notas, la asistencia y las tareas de
${access.children.map((c) => `<strong>${escapeHtml(c)}</strong>`).join(", ")} desde su teléfono o computadora.</p>
<div class="box"><p>Entre a: <span class="big">${escapeHtml(site)}</span></p>
<p>Usuario: <span class="big">${escapeHtml(access.login)}</span></p>
<p>Contraseña temporal: <span class="big">${escapeHtml(access.temporaryPassword ?? "")}</span></p></div>
<ol><li>Escriba su usuario y la contraseña temporal.</li><li>El sistema le pedirá crear una contraseña nueva que solo usted conozca.</li>
<li>Si la olvida, pida en la secretaría una nueva contraseña temporal.</li></ol>
<p class="muted">No comparta esta hoja. La contraseña temporal deja de servir cuando usted la cambia.</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
}

export function PortalAccess({
  studentId,
  guardian,
  schoolName,
}: {
  studentId: string;
  guardian: GuardianLinkDto;
  schoolName: string;
}) {
  const [state, action] = useActionState<PortalAccessState, FormData>(portalAccessAction, {});
  const access = state.access;

  return (
    <div className="mt-2 space-y-2">
      <FormAlert state={access ? {} : state} />
      {access && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-900"
        >
          {access.temporaryPassword ? (
            <>
              <p>
                Acceso listo. {access.guardianName} entra con <strong>{access.login}</strong> y la contraseña
                temporal <strong className="font-mono">{access.temporaryPassword}</strong> (la cambiará al
                entrar). Verá a {access.children.join(", ")}.
              </p>
              <p className="text-xs">
                Esta contraseña no se vuelve a mostrar: imprime la carta o anótala ahora.
              </p>
              <button
                type="button"
                className="btn-primary px-3 py-1.5"
                onClick={() => printLetter(access, schoolName)}
              >
                Imprimir carta de acceso
              </button>
            </>
          ) : (
            <p>
              {access.guardianName} ya tenía cuenta: entra con <strong>{access.login}</strong> y su contraseña
              de siempre; ahora también verá a {access.children.join(", ")}.
            </p>
          )}
        </div>
      )}

      {guardian.hasPortalAccess ? (
        <form action={action} className="flex flex-wrap items-center gap-2 text-xs">
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="guardianId" value={guardian.id} />
          <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">
            Con acceso al portal
          </span>
          <IntentButton intent="restablecer" className="font-semibold text-brand-700 hover:underline">
            Nueva contraseña temporal
          </IntentButton>
          <IntentButton
            intent="quitar"
            className="font-semibold text-slate-500 hover:text-red-700"
            confirmText={`¿Quitar el acceso al portal de ${guardian.fullName}?`}
          >
            Quitar acceso
          </IntentButton>
        </form>
      ) : (
        !access && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">
              Dar acceso al portal de familias
            </summary>
            <form
              action={action}
              className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3"
              noValidate
            >
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="guardianId" value={guardian.id} />
              <p className="text-xs text-slate-500">
                Entrará con su número de identidad (o su correo, si no se tiene la identidad).
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field
                  name="nationalId"
                  label="Identidad"
                  placeholder="0801-1985-01234"
                  defaultValue={
                    state.values?.nationalId ??
                    (guardian.nationalId ? formatNationalId(guardian.nationalId) : "")
                  }
                  state={state}
                />
                <Field
                  name="email"
                  label="Correo (opcional)"
                  type="email"
                  defaultValue={state.values?.email ?? guardian.email ?? ""}
                  state={state}
                />
              </div>
              <IntentButton intent="dar" className="btn-primary px-3 py-1.5">
                Crear acceso
              </IntentButton>
            </form>
          </details>
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
