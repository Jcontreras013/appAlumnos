"use client";

import {
  formatFileSize,
  LIBRARY_AUDIENCE_LABELS,
  LIBRARY_AUDIENCES,
  LIBRARY_FILE_TYPES,
  LIBRARY_MAX_BYTES,
  libraryFileMetaSchema,
  libraryTypeOf,
} from "@escolar/shared";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { addLibraryLinkAction, type LinkFormState } from "./actions";

interface Option {
  id: string;
  name: string;
}

const ACCEPT = Object.entries(LIBRARY_FILE_TYPES)
  .flatMap(([mime, t]) => [mime, `.${t.ext}`])
  .join(",");

/** Título a partir del nombre del archivo: «guia_de_lectura-3.pdf» → «guia de lectura 3». */
const titleFromName = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

export function AddMaterial({ grades, subjects }: { grades: Option[]; subjects: Option[] }) {
  const [mode, setMode] = useState<"archivo" | "enlace">("archivo");
  const [open, setOpen] = useState(false);
  return (
    <details className="card" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-brand-700 marker:hidden">
        + Agregar material
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-4">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="tablist">
          {(
            [
              ["archivo", "Subir archivo"],
              ["enlace", "Agregar enlace"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                mode === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "archivo" ? (
          <UploadForm grades={grades} subjects={subjects} onDone={() => setOpen(false)} />
        ) : (
          <LinkForm grades={grades} subjects={subjects} onDone={() => setOpen(false)} />
        )}
      </div>
    </details>
  );
}

function PlacementFields({
  grades,
  subjects,
  idPrefix,
}: {
  grades: Option[];
  subjects: Option[];
  idPrefix: string;
}) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-grade`} className="label">
          Grado
        </label>
        <select id={`${idPrefix}-grade`} name="gradeId" className="input" defaultValue="">
          <option value="">Todo el centro</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-subject`} className="label">
          Materia
        </label>
        <select id={`${idPrefix}-subject`} name="subjectId" className="input" defaultValue="">
          <option value="">Ninguna en particular</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** Quién lo puede ver: hay que elegirlo siempre (una guía con respuestas no debe llegar a las familias por descuido). */
function AudienceField({ idPrefix }: { idPrefix: string }) {
  return (
    <fieldset>
      <legend className="label">¿Quién lo puede ver?</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {LIBRARY_AUDIENCES.map((a) => (
          <label key={a} htmlFor={`${idPrefix}-${a}`} className="flex items-center gap-2 text-sm">
            <input id={`${idPrefix}-${a}`} type="radio" name="audience" value={a} required />
            {LIBRARY_AUDIENCE_LABELS[a]}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Las familias ven solo lo de los grados de sus hijos (y lo que es para todo el centro).
      </p>
    </fieldset>
  );
}

type Upload =
  | { state: "idle" }
  | { state: "sending"; progress: number }
  | { state: "error"; message: string };

function send(file: File, query: URLSearchParams, onProgress: (f: number) => void) {
  return new Promise<{ status: number; body: unknown }>((done) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/biblioteca?${query}`);
    xhr.setRequestHeader("content-type", libraryTypeOf(file.name, file.type) ?? "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // respuesta sin JSON
      }
      done({ status: xhr.status, body });
    };
    xhr.onerror = () => done({ status: 0, body: null });
    xhr.send(file);
  });
}

function UploadForm({
  grades,
  subjects,
  onDone,
}: {
  grades: Option[];
  subjects: Option[];
  onDone: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const sending = upload.state === "sending";

  function pick(chosen: File | null) {
    setUpload({ state: "idle" });
    if (!chosen) return setFile(null);
    if (!libraryTypeOf(chosen.name, chosen.type)) {
      setFile(null);
      setUpload({
        state: "error",
        message: `«${chosen.name}» no se puede subir: solo PDF, Word, Excel o PowerPoint.`,
      });
      return;
    }
    if (chosen.size > LIBRARY_MAX_BYTES) {
      setFile(null);
      setUpload({
        state: "error",
        message: `«${chosen.name}» pesa ${formatFileSize(chosen.size)}: el máximo es ${formatFileSize(LIBRARY_MAX_BYTES)}.`,
      });
      return;
    }
    setFile(chosen);
    if (!title) setTitle(titleFromName(chosen.name));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setUpload({ state: "error", message: "Elige el archivo." });
    const data = new FormData(e.currentTarget);
    const meta = libraryFileMetaSchema.safeParse({
      title,
      description: data.get("description"),
      gradeId: data.get("gradeId"),
      subjectId: data.get("subjectId"),
      audience: data.get("audience"),
    });
    if (!meta.success) {
      return setUpload({ state: "error", message: meta.error.issues[0]?.message ?? "Revisa los datos" });
    }
    const query = new URLSearchParams({ titulo: meta.data.title, para: meta.data.audience });
    if (meta.data.description) query.set("descripcion", meta.data.description);
    if (meta.data.gradeId) query.set("grado", meta.data.gradeId);
    if (meta.data.subjectId) query.set("materia", meta.data.subjectId);

    setUpload({ state: "sending", progress: 0 });
    const progress = (p: number) => setUpload({ state: "sending", progress: p });
    let res = await send(file, query, progress);
    if (res.status === 401) {
      // La sesión venció mientras elegía: se renueva y se intenta otra vez.
      await fetch("/panel/sesion", { cache: "no-store" }).catch(() => {});
      res = await send(file, query, progress);
    }
    if (res.status === 201) {
      form.current?.reset();
      setFile(null);
      setTitle("");
      setUpload({ state: "idle" });
      onDone();
      router.refresh();
      return;
    }
    if (res.status === 401) return window.location.reload();
    const message =
      res.status === 0
        ? "No se subió. Revisa tu conexión e intenta de nuevo."
        : ((res.body as { error?: { message?: string } } | null)?.error?.message ??
          "No se pudo subir el archivo.");
    setUpload({ state: "error", message });
  }

  return (
    <form ref={form} onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor={`${id}-file`} className="label">
          Archivo (PDF, Word, Excel o PowerPoint, hasta {formatFileSize(LIBRARY_MAX_BYTES)})
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-700"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          disabled={sending}
        />
        {file && <p className="mt-1 text-xs text-slate-500">{formatFileSize(file.size)}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className="label">
            Título
          </label>
          <input
            id={`${id}-title`}
            className="input"
            value={title}
            maxLength={150}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ej.: Libro de Español, 3.er grado"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-desc`} className="label">
            Descripción (opcional)
          </label>
          <input
            id={`${id}-desc`}
            name="description"
            className="input"
            maxLength={500}
            placeholder="Ej.: Unidades 1 a 4. Leer antes de cada clase."
          />
        </div>
        <PlacementFields grades={grades} subjects={subjects} idPrefix={id} />
      </div>
      <AudienceField idPrefix={id} />
      {upload.state === "sending" && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-600 transition-[width]"
              style={{ width: `${Math.round(upload.progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">Subiendo… {Math.round(upload.progress * 100)} %</p>
        </div>
      )}
      {upload.state === "error" && (
        <p className="text-sm font-medium text-red-700" role="alert">
          {upload.message}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={sending}>
        {sending ? "Subiendo…" : "Subir a la biblioteca"}
      </button>
    </form>
  );
}

const initial: LinkFormState = { ok: false, error: null, at: 0 };

function LinkForm({
  grades,
  subjects,
  onDone,
}: {
  grades: Option[];
  subjects: Option[];
  onDone: () => void;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addLibraryLinkAction, initial);
  // Cada envío exitoso se atiende una sola vez (no cada vez que se vuelve a dibujar).
  const handled = useRef(0);
  useEffect(() => {
    if (state.ok && state.at !== handled.current) {
      handled.current = state.at;
      form.current?.reset();
      onDone();
    }
  }, [state, onDone]);
  return (
    <form ref={form} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-url`} className="label">
            Enlace
          </label>
          <input
            id={`${id}-url`}
            name="url"
            type="url"
            inputMode="url"
            className="input"
            placeholder="https://…"
            maxLength={500}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className="label">
            Título
          </label>
          <input
            id={`${id}-title`}
            name="title"
            className="input"
            maxLength={150}
            placeholder="Ej.: Educatrachos: libros de texto de 4.º grado"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-desc`} className="label">
            Descripción (opcional)
          </label>
          <input id={`${id}-desc`} name="description" className="input" maxLength={500} />
        </div>
        <PlacementFields grades={grades} subjects={subjects} idPrefix={id} />
      </div>
      <AudienceField idPrefix={id} />
      {state.error && (
        <p className="text-sm font-medium text-red-700" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Guardando…" : "Agregar enlace"}
      </button>
    </form>
  );
}
