"use client";

import { FOLLOW_UP_KINDS, FOLLOW_UP_LABELS, todayInHonduras } from "@escolar/shared";
import { addFollowUpAction } from "@/app/panel/seguimiento/actions";
import { Field, SelectField, TextAreaField } from "@/components/form-controls";
import { InlineEditor } from "@/components/inline-editor";

/** Botón «Registrar seguimiento» con la ventana para anotar qué se hizo y qué se acordó. */
export function FollowUpEditor({ studentId, studentName }: { studentId: string; studentName: string }) {
  return (
    <InlineEditor
      id={studentId}
      what={studentName}
      trigger="Registrar seguimiento"
      update={addFollowUpAction}
      fields={(state, idPrefix) => (
        <>
          <SelectField
            idPrefix={idPrefix}
            name="kind"
            label="¿Qué se hizo?"
            options={FOLLOW_UP_KINDS.map((k) => ({ value: k, label: FOLLOW_UP_LABELS[k] }))}
            placeholder="Elige…"
            state={state}
          />
          <Field
            idPrefix={idPrefix}
            name="date"
            label="Fecha"
            type="date"
            max={todayInHonduras()}
            defaultValue={state.values?.date ?? todayInHonduras()}
            state={state}
          />
          <TextAreaField
            idPrefix={idPrefix}
            name="notes"
            label="¿Qué se acordó?"
            rows={4}
            placeholder="Por ejemplo: la familia traerá la constancia médica el lunes."
            defaultValue={state.values?.notes}
            state={state}
          />
        </>
      )}
    />
  );
}
