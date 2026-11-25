"use client";

import { ROLE_LABELS } from "@escolar/shared";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type EraseAccountState, eraseAccountAction, resetMfaAction } from "@/app/panel/actions";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { createDepartmentAction, createDistrictAction, createRegionalUserAction } from "./actions";

type Option = { value: string; label: string };

export function DepartmentForm() {
  const [state, action] = useActionState(createDepartmentAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <div className="grid grid-cols-[5rem_1fr] gap-3">
        <Field name="code" label="Código" placeholder="11" inputMode="numeric" required state={state} />
        <Field name="name" label="Departamento" placeholder="Islas de la Bahía" required state={state} />
      </div>
      <SubmitButton pendingText="Creando…">Crear departamento</SubmitButton>
    </form>
  );
}

export function DistrictForm({ departments }: { departments: Option[] }) {
  const [state, action] = useActionState(createDistrictAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField name="departmentId" label="Departamento" options={departments} state={state} />
      <Field name="name" label="Distrito" placeholder="Roatán" required state={state} />
      <SubmitButton pendingText="Creando…">Crear distrito</SubmitButton>
    </form>
  );
}

export function RegionalUserForm({ scopes }: { scopes: Option[] }) {
  const [state, action] = useActionState(createRegionalUserAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <SelectField
        name="scopeId"
        label="Dirección de"
        placeholder="Elige el departamento o distrito…"
        options={scopes}
        state={state}
      />
      <Field name="name" label="Nombre completo" required state={state} />
      <Field name="email" label="Correo" type="email" required state={state} />
      <Field
        name="password"
        label="Contraseña temporal"
        type="password"
        autoComplete="new-password"
        required
        state={state}
      />
      <SubmitButton pendingText="Creando…">Dar acceso</SubmitButton>
    </form>
  );
}

/** Para quien perdió el teléfono y sus códigos de recuperación. */
export function ResetMfaForm() {
  const [state, action] = useActionState(resetMfaAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field
        name="login"
        label="Correo o identidad de la persona"
        idPrefix="restablecer-2fa"
        required
        state={state}
        hint="Vuelve a entrar solo con su contraseña y activa la verificación de nuevo."
      />
      <SubmitButton pendingText="Restableciendo…">Restablecer verificación</SubmitButton>
    </form>
  );
}

const initialEraseState: EraseAccountState = {};

function EraseButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn w-full bg-red-600 text-white shadow-sm hover:bg-red-700 sm:w-auto"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Eliminando…" : "Eliminar la cuenta"}
    </button>
  );
}

/**
 * Eliminar una cuenta a pedido de la persona (lo que promete /eliminar-cuenta). Primero se busca y se
 * muestra de quién es y dónde tiene acceso; se elimina solo después de escribir ELIMINAR.
 */
export function EraseAccountForm() {
  const [state, action] = useActionState(eraseAccountAction, initialEraseState);
  const found = state.found;
  if (!found) {
    return (
      <form action={action} className="space-y-3" noValidate>
        <FormAlert state={state} />
        <input type="hidden" name="intent" value="buscar" />
        <Field
          name="login"
          label="Correo o identidad de la persona"
          idPrefix="eliminar-cuenta"
          required
          state={state}
          hint="Antes de eliminarla se muestra de quién es la cuenta."
        />
        <SubmitButton pendingText="Buscando…">Buscar la cuenta</SubmitButton>
      </form>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="font-medium text-slate-900">{found.name}</p>
        <p className="text-slate-500">{found.login}</p>
        <ul className="mt-2 space-y-0.5 text-slate-600">
          {found.accesses.map((a) => (
            <li key={`${a.role}-${a.place ?? ""}`}>
              {ROLE_LABELS[a.role]}
              {a.place ? ` · ${a.place}` : ""}
              {a.active ? "" : " (sin acceso)"}
            </li>
          ))}
        </ul>
      </div>
      {found.platformTeam ? (
        <p className="text-sm text-amber-700">
          Es una cuenta del equipo de la plataforma: no se elimina desde aquí.
        </p>
      ) : (
        <form action={action} className="space-y-3" noValidate>
          <FormAlert state={state} />
          <p className="text-xs text-slate-500">
            Se borran su correo o identidad, su contraseña, la verificación en dos pasos, sus sesiones y los
            avisos del teléfono. El registro escolar queda en su centro. No se puede deshacer.
          </p>
          <input type="hidden" name="intent" value="eliminar" />
          <input type="hidden" name="id" value={found.id} />
          <Field
            name="confirmacion"
            label="Escribe ELIMINAR para confirmar"
            idPrefix="eliminar-cuenta"
            autoComplete="off"
            required
            state={state}
          />
          <EraseButton />
        </form>
      )}
      <form action={action}>
        <input type="hidden" name="intent" value="otra" />
        <button type="submit" className="text-sm font-medium text-brand-700 hover:underline">
          Buscar otra cuenta
        </button>
      </form>
    </div>
  );
}
