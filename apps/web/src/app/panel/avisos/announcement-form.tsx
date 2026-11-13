"use client";

import { ANNOUNCEMENT_AUDIENCE_LABELS, ANNOUNCEMENT_AUDIENCES } from "@escolar/shared";
import { useActionState } from "react";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { publishAnnouncementAction } from "./actions";

export function AnnouncementForm({ sections }: { sections: Array<{ value: string; label: string }> }) {
  const [state, action] = useActionState(publishAnnouncementAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ? state.message : "aviso"}>
      <FormAlert state={state} />
      <Field name="title" label="Título" required placeholder="Reunión de padres" state={state} />
      <TextAreaField
        name="body"
        label="Aviso"
        rows={5}
        placeholder="Qué, cuándo y dónde."
        defaultValue={state.ok ? "" : state.values?.body}
        state={state}
      />
      <SelectField
        name="audience"
        label="Para"
        options={ANNOUNCEMENT_AUDIENCES.map((a) => ({ value: a, label: ANNOUNCEMENT_AUDIENCE_LABELS[a] }))}
        defaultValue="todos"
        state={state}
      />
      <SelectField
        name="sectionId"
        label="Sección"
        options={sections}
        placeholder="Todo el centro"
        state={state}
      />
      <Field name="expiresOn" label="Se muestra hasta" type="date" hint="Vacío: 30 días." state={state} />
      <SubmitButton pendingText="Publicando…">Publicar aviso</SubmitButton>
    </form>
  );
}
