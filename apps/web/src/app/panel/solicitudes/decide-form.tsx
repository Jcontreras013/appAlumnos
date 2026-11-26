"use client";

import { useActionState, useState } from "react";
import { FormAlert } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { decideChangeRequestAction } from "./actions";

/** Confirmar o rechazar (con una nota opcional para la secretaría). */
export function DecideForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(decideChangeRequestAction, initialFormState);
  const [rejecting, setRejecting] = useState(false);
  if (state.ok) return <FormAlert state={state} />;
  return (
    <form action={action} className="space-y-2">
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      {rejecting && (
        <input
          name="note"
          className="input"
          placeholder="Por qué se rechaza (opcional)"
          maxLength={500}
          aria-label="Motivo del rechazo"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <button
              type="submit"
              name="decision"
              value="rechazar"
              disabled={pending}
              className="btn-secondary"
            >
              Rechazar
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="text-sm text-slate-500">
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button
              type="submit"
              name="decision"
              value="confirmar"
              disabled={pending}
              className="btn-primary"
            >
              {pending ? "Confirmando…" : "Confirmar"}
            </button>
            <button type="button" onClick={() => setRejecting(true)} className="btn-secondary">
              Rechazar
            </button>
          </>
        )}
      </div>
    </form>
  );
}
