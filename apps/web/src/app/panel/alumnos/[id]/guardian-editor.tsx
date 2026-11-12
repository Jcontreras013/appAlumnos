"use client";

import { formatNationalId, type GuardianLinkDto, RELATIONSHIP_LABELS, RELATIONSHIPS } from "@escolar/shared";
import { Field, SelectField } from "@/components/form-controls";
import { InlineEditor } from "@/components/inline-editor";
import { updateGuardianAction } from "../actions";

/** Corregir nombre, identidad, teléfono, correo o parentesco de un responsable. */
export function GuardianEditor({ studentId, guardian }: { studentId: string; guardian: GuardianLinkDto }) {
  return (
    <InlineEditor
      id={guardian.id}
      what={guardian.fullName}
      trigger="Corregir datos"
      hidden={{ studentId }}
      update={updateGuardianAction}
      fields={(state, idPrefix) => (
        <>
          <Field
            idPrefix={idPrefix}
            name="fullName"
            label="Nombre completo"
            required
            state={state}
            defaultValue={state.values?.fullName ?? guardian.fullName}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              idPrefix={idPrefix}
              name="relationship"
              label="Parentesco"
              options={RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }))}
              defaultValue={guardian.relationship}
              state={state}
            />
            <Field
              idPrefix={idPrefix}
              name="nationalId"
              label="Identidad"
              inputMode="numeric"
              state={state}
              defaultValue={
                state.values?.nationalId ?? (guardian.nationalId ? formatNationalId(guardian.nationalId) : "")
              }
            />
            <Field
              idPrefix={idPrefix}
              name="phone"
              label="Teléfono"
              inputMode="tel"
              state={state}
              defaultValue={state.values?.phone ?? guardian.phone ?? ""}
            />
            <Field
              idPrefix={idPrefix}
              name="email"
              label="Correo"
              type="email"
              state={state}
              defaultValue={state.values?.email ?? guardian.email ?? ""}
            />
          </div>
          <p className="text-xs text-slate-500">
            Los datos valen para todos sus hijos en el centro. Si ya tiene acceso al portal, sigue entrando
            con el usuario que se le entregó.
          </p>
        </>
      )}
    />
  );
}
