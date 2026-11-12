"use client";

import { ROLE_LABELS, type Role, STAFF_ROLES } from "@escolar/shared";
import { SelectField } from "@/components/form-controls";
import { InlineEditor } from "@/components/inline-editor";
import { changeRoleAction } from "./actions";

/** Cambiar el cargo de una persona en este centro; si tiene dos cargos, el otro no cambia. */
export function RoleEditor({ user }: { user: { id: string; name: string; role: Role } }) {
  return (
    <InlineEditor
      id={user.id}
      what={user.name}
      trigger="Cambiar cargo"
      hidden={{ from: user.role }}
      update={changeRoleAction}
      fields={(state, idPrefix) => (
        <>
          <SelectField
            idPrefix={idPrefix}
            name="to"
            label={`Cargo nuevo (ahora: ${ROLE_LABELS[user.role]})`}
            options={STAFF_ROLES.filter((r) => r !== user.role).map((r) => ({
              value: r,
              label: ROLE_LABELS[r],
            }))}
            placeholder="Elige…"
            state={state}
          />
          <p className="text-xs text-slate-500">
            Vale desde su próximo ingreso. Si deja de dar clases, reasigna sus materias en Estructura
            académica con «Cambiar docente».
          </p>
        </>
      )}
    />
  );
}
