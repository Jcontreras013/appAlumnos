"use client";

import { type ReactNode, useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { FormAlert } from "@/components/form-controls";
import { type FormState, initialFormState } from "@/lib/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

interface EditorProps {
  /** Id de lo que se edita: viaja en los dos formularios (guardar y eliminar). */
  id: string;
  /** Nombre de lo que se edita: título de la ventana y etiqueta del botón ("Editar Primer grado"). */
  what: string;
  update: Action;
  remove?: Action;
  removeLabel?: string;
  fields: (state: FormState, idPrefix: string) => ReactNode;
  trigger?: string;
  /** Datos extra que viajan en los dos formularios (por ejemplo, el alumno de un responsable). */
  hidden?: Record<string, string>;
}

/**
 * Botón ("Editar", "Corregir datos"…) que abre una ventana para corregir y, si se puede, eliminar.
 * Se cierra sola al guardar; si el servicio rechaza algo, el motivo se ve en la misma ventana. Cada
 * vez que se abre empieza limpia. Es una ventana y no un panel en línea para que funcione igual
 * dentro de tablas angostas que en listas.
 */
export function InlineEditor(props: EditorProps) {
  const [openCount, setOpenCount] = useState(0);
  const [open, setOpen] = useState(false);
  const trigger = props.trigger ?? "Editar";
  return (
    <>
      <button
        type="button"
        className="text-xs font-semibold text-brand-700 hover:underline"
        aria-label={`${trigger} ${props.what}`}
        onClick={() => {
          setOpenCount((n) => n + 1);
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open && <EditorDialog key={openCount} {...props} trigger={trigger} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditorDialog({
  id,
  what,
  update,
  remove,
  removeLabel,
  fields,
  trigger,
  hidden = {},
  onClose,
}: EditorProps & { trigger: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const [saved, save] = useActionState(update, initialFormState);
  const [removed, removeAction] = useActionState<FormState, FormData>(
    remove ?? (async () => ({})),
    initialFormState,
  );

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  // Si no se pudo eliminar, se muestra el motivo y se quita la confirmación.
  useEffect(() => {
    if (removed.error) setConfirming(false);
  }, [removed]);
  // Al guardar, la página se vuelve a pintar con el dato corregido y la ventana se cierra.
  useEffect(() => {
    if (saved.ok) dialog.current?.close();
  }, [saved]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 text-left text-slate-900 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="space-y-4 p-5">
        <h2 id={titleId} className="font-semibold text-slate-900">
          {trigger}: {what}
        </h2>
        <form action={save} className="space-y-3" noValidate>
          <Hidden id={id} extra={hidden} />
          <FormAlert state={saved.ok ? {} : saved} />
          {fields(saved, `editar-${id}`)}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Save />
            <button
              type="button"
              className="text-sm text-slate-600 hover:underline"
              onClick={() => dialog.current?.close()}
            >
              Cancelar
            </button>
          </div>
        </form>
        {remove && (
          <form action={removeAction} className="space-y-2 border-t border-slate-100 pt-3">
            <Hidden id={id} extra={hidden} />
            <FormAlert state={removed.ok ? {} : removed} />
            {confirming ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-slate-700">¿Eliminar {what}?</span>
                <DangerSubmit>Sí, eliminar</DangerSubmit>
                <button
                  type="button"
                  className="text-slate-600 hover:underline"
                  onClick={() => setConfirming(false)}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs font-semibold text-red-700 hover:underline"
                onClick={() => setConfirming(true)}
              >
                {removeLabel ?? "Eliminar"}
              </button>
            )}
          </form>
        )}
      </div>
    </dialog>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary px-3 py-1.5 text-sm" disabled={pending} aria-busy={pending}>
      {pending ? "Guardando…" : "Guardar"}
    </button>
  );
}

function DangerSubmit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Eliminando…" : children}
    </button>
  );
}

function Hidden({ id, extra }: { id: string; extra: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}
