"use client";

import { formatNationalId, type UserDto } from "@escolar/shared";
import { updateAccountAction } from "@/app/panel/actions";
import { Field } from "@/components/form-controls";
import { InlineEditor } from "@/components/inline-editor";

/**
 * Corregir el nombre, la identidad o el correo de una persona (errores de captura). Si cambia con
 * qué entra, se cierran sus sesiones y entra con el dato nuevo y su misma contraseña.
 */
export function AccountEditor({ user }: { user: Pick<UserDto, "id" | "name" | "nationalId" | "email"> }) {
  return (
    <InlineEditor
      id={user.id}
      what={user.name}
      trigger="Corregir datos"
      update={updateAccountAction}
      fields={(state, idPrefix) => (
        <>
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Nombre completo"
            required
            state={state}
            defaultValue={state.values?.name ?? user.name}
          />
          <Field
            idPrefix={idPrefix}
            name="nationalId"
            label="Número de identidad"
            inputMode="numeric"
            placeholder="0801-1990-01234"
            state={state}
            defaultValue={
              state.values?.nationalId ?? (user.nationalId ? formatNationalId(user.nationalId) : "")
            }
          />
          <Field
            idPrefix={idPrefix}
            name="email"
            label="Correo"
            type="email"
            state={state}
            defaultValue={state.values?.email ?? user.email ?? ""}
          />
          <p className="text-xs text-slate-500">
            Entra con la identidad (o con el correo si no tiene). Si los cambias, entrará con el dato nuevo y
            su misma contraseña.
          </p>
        </>
      )}
    />
  );
}
