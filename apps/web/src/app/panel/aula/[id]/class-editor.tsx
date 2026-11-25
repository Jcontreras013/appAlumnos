"use client";

import {
  CLASS_FILE_MAX_BYTES,
  type ClassPostDto,
  type ClassPostKind,
  classFileTypeOf,
  formatFileSize,
} from "@escolar/shared";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field, FormAlert, TextAreaField } from "@/components/form-controls";
import type { FormState } from "@/lib/form-state";
import { uploadError, uploadFile } from "@/lib/upload-client";
import { addClassLinkAction, saveClassPostAction, saveClassSettingsAction } from "../actions";

function Submit({ children, pending: pendingText }: { children: React.ReactNode; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary px-3 py-1.5" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Enlace de la clase en línea (Meet, Zoom o Jitsi) y cuándo es. */
export function MeetingForm({
  assignmentId,
  meetingUrl,
  meetingNote,
}: {
  assignmentId: string;
  meetingUrl: string | null;
  meetingNote: string | null;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveClassSettingsAction, {});
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <FormAlert state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          idPrefix="clase-en-linea"
          name="meetingUrl"
          label="Enlace de la clase en línea"
          placeholder="https://meet.google.com/…"
          defaultValue={state.values?.meetingUrl ?? meetingUrl ?? ""}
          state={state}
          hint="Meet, Zoom o Jitsi. Déjalo vacío para quitarlo."
        />
        <Field
          idPrefix="clase-en-linea"
          name="meetingNote"
          label="Cuándo (opcional)"
          placeholder="Martes y jueves, 3:00 p. m."
          defaultValue={state.values?.meetingNote ?? meetingNote ?? ""}
          state={state}
        />
      </div>
      <Submit pending="Guardando…">Guardar enlace</Submit>
    </form>
  );
}

/** Publicar un tema o aviso nuevo, o corregir uno. */
export function PostForm({
  assignmentId,
  kind,
  post,
  onDone,
}: {
  assignmentId: string;
  kind: ClassPostKind;
  post?: ClassPostDto;
  onDone?: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<FormState, FormData>(saveClassPostAction, {});
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      if (!post) form.current?.reset();
      onDone?.();
    }
  }, [state, post, onDone]);
  return (
    <form ref={form} action={action} className="space-y-3" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="kind" value={kind} />
      {post && <input type="hidden" name="postId" value={post.id} />}
      <FormAlert state={state} />
      <Field
        idPrefix={id}
        name="title"
        label={kind === "tema" ? "Título del tema" : "Título del aviso"}
        placeholder={kind === "tema" ? "Unidad 3: Fracciones equivalentes" : "Mañana hay prueba corta"}
        defaultValue={state.values?.title ?? post?.title ?? ""}
        state={state}
        required
      />
      <TextAreaField
        idPrefix={id}
        name="body"
        label={kind === "tema" ? "Explicación" : "Mensaje"}
        rows={kind === "tema" ? 8 : 3}
        defaultValue={state.values?.body ?? post?.body ?? ""}
        state={state}
        hint={
          kind === "tema"
            ? "Explica el tema con tus palabras. Los enlaces que pegues se pueden tocar. Después agregas videos, archivos y enlaces."
            : undefined
        }
      />
      <Submit pending="Guardando…">{post ? "Guardar cambios" : "Publicar"}</Submit>
    </form>
  );
}

/** Un botón que abre el formulario (para no llenar la página de formularios abiertos). */
export function Toggle({
  label,
  className = "btn-secondary px-3 py-1.5",
  children,
}: {
  label: string;
  className?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {children(() => setOpen(false))}
      <button
        type="button"
        className="text-xs font-semibold text-slate-500 hover:text-slate-800"
        onClick={() => setOpen(false)}
      >
        Cancelar
      </button>
    </div>
  );
}

/** Agregar un enlace o un video de YouTube a un tema. */
export function LinkForm({ assignmentId, postId }: { assignmentId: string; postId: string }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<FormState, FormData>(addClassLinkAction, {});
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      form.current?.reset();
    }
  }, [state]);
  return (
    <form ref={form} action={action} className="space-y-2" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="postId" value={postId} />
      <FormAlert state={state.ok ? {} : state} />
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <Field
          idPrefix={id}
          name="url"
          label="Enlace"
          placeholder="https://youtu.be/… o https://…"
          defaultValue={state.ok ? "" : (state.values?.url ?? "")}
          state={state}
          hint="Los videos de YouTube se ven dentro de la clase."
        />
        <Field
          idPrefix={id}
          name="title"
          label="Título (opcional)"
          defaultValue={state.ok ? "" : (state.values?.title ?? "")}
          state={state}
        />
      </div>
      <Submit pending="Agregando…">Agregar</Submit>
    </form>
  );
}

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

/** Subir un archivo (PDF, Office o imagen) a una ruta del panel, con barra de avance. */
export function UploadBox({
  url,
  max = CLASS_FILE_MAX_BYTES,
  label,
  capture = false,
}: {
  url: string;
  max?: number;
  label: string;
  /** En el teléfono, ofrecer la cámara (para la foto del cuaderno). */
  capture?: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | null, input: HTMLInputElement) {
    setError(null);
    if (!file) return;
    const type = classFileTypeOf(file.name, file.type);
    if (!type) {
      setError(`«${file.name}» no se puede subir: fotos, PDF, Word, Excel o PowerPoint.`);
      return;
    }
    if (file.size > max) {
      setError(`«${file.name}» pesa ${formatFileSize(file.size)}: el máximo es ${formatFileSize(max)}.`);
      return;
    }
    setProgress(0);
    const res = await uploadFile(url, file, type, setProgress);
    setProgress(null);
    input.value = "";
    if (res.status === 201) return router.refresh();
    if (res.status === 401) return window.location.reload();
    setError(uploadError(res));
  }

  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-archivo`} className="label">
        {label} (hasta {formatFileSize(max)})
      </label>
      <input
        id={`${id}-archivo`}
        type="file"
        accept={capture ? `image/*,${ACCEPT}` : ACCEPT}
        disabled={progress !== null}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700"
        onChange={(e) => void pick(e.target.files?.[0] ?? null, e.target)}
      />
      {progress !== null && (
        <div className="space-y-1" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-600" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="text-xs text-slate-500">Subiendo… {Math.round(progress * 100)} %</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Subir un archivo a un tema. */
export function FileUpload({ postId }: { postId: string }) {
  return (
    <UploadBox url={`/api/aula/temas/${postId}/archivos`} label="Subir archivo (PDF, Office o imagen)" />
  );
}

/** Botón que pide confirmación antes de enviar el formulario (borrar). */
export function ConfirmButton({
  confirmText,
  className,
  children,
}: {
  confirmText: string;
  className: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** «Nuevo tema» / «Nuevo aviso»: abre el formulario. */
export function NewPost({ assignmentId, kind }: { assignmentId: string; kind: ClassPostKind }) {
  return (
    <Toggle label={kind === "tema" ? "+ Nuevo tema" : "+ Nuevo aviso"} className="btn-primary">
      {(close) => <PostForm assignmentId={assignmentId} kind={kind} onDone={close} />}
    </Toggle>
  );
}

export function EditPost({ assignmentId, post }: { assignmentId: string; post: ClassPostDto }) {
  return (
    <Toggle label="Editar" className="text-xs font-semibold text-brand-700 hover:underline">
      {(close) => <PostForm assignmentId={assignmentId} kind={post.kind} post={post} onDone={close} />}
    </Toggle>
  );
}

/** Agregar material a un tema: enlace/video o archivo. */
export function AddMaterial({ assignmentId, postId }: { assignmentId: string; postId: string }) {
  return (
    <Toggle
      label="+ Agregar video, enlace o archivo"
      className="text-sm font-semibold text-brand-700 hover:underline"
    >
      {() => (
        <div className="space-y-4">
          <LinkForm assignmentId={assignmentId} postId={postId} />
          <div className="border-t border-slate-200 pt-3">
            <FileUpload postId={postId} />
          </div>
        </div>
      )}
    </Toggle>
  );
}
