import { currentPeriod, formatFileSize, type TaskFileDto, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Linkify } from "@/components/linkify";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { deleteTaskAction, deleteTaskFileAction } from "../../../actions";
import { PublishBadge, StatusBadge } from "../../../status-badge";
import { ConfirmButton } from "../../class-editor";
import { EditTask, GradeForm, SubmissionForm, TaskAttachmentUpload } from "../task-forms";

export const metadata: Metadata = { title: "Tarea" };

const when = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  }).format(new Date(iso));
const shortWhen = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  }).format(new Date(iso));

/** Una tarea del aula virtual: el maestro califica las entregas; el alumno o su familia entrega. */
export default async function TaskPage({
  params,
  searchParams,
}: PageProps<"/panel/aula/[id]/tareas/[taskId]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria", "estudiante", "padre");
  const { id, taskId } = await params;
  const query = await searchParams;
  const alumno =
    typeof query.alumno === "string" && /^[0-9a-f-]{36}$/i.test(query.alumno) ? query.alumno : undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(taskId)) notFound();
  const detail = await academic.classTask(session.accessToken, taskId, alumno).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const { task } = detail;
  if (task.assignmentId !== id) notFound();
  const staffView = detail.submissions !== null;
  const periods = detail.canEdit ? (await academic.periods(session.accessToken)).periods : [];
  const current = currentPeriod(periods, todayInHonduras());
  const overdue = new Date(task.dueAt) < new Date();
  // Revisión: primero quienes entregaron (en el orden en que entregaron) y, por defecto, solo ellos.
  const all = detail.submissions ?? [];
  const turnedIn = all
    .filter((s) => s.submittedAt)
    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  const missing = all.filter((s) => !s.submittedAt);
  const showAll = query.ver === "todos" || turnedIn.length === 0;
  const listed = showAll ? [...turnedIn, ...missing] : turnedIn;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/panel/aula/${id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← {detail.subjectName} · {detail.sectionLabel}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold text-slate-900">
              {task.title}
              <PublishBadge task={task} />
            </h1>
            <p className={`text-sm ${overdue ? "text-red-700" : "text-slate-500"}`}>
              Entrega: {when(task.dueAt)}
              {!task.allowLate && " · no se aceptan entregas tarde"}
            </p>
            <p className="text-sm text-slate-500">
              {task.points === null ? "Sin nota" : `Vale ${task.points} puntos · ${task.periodName ?? ""}`}
            </p>
          </div>
          {detail.canEdit && (
            <div className="flex flex-wrap items-start gap-2">
              <EditTask
                assignmentId={id}
                periods={periods}
                currentPeriodId={current?.id ?? null}
                task={task}
              />
              <form action={deleteTaskAction}>
                <input type="hidden" name="assignmentId" value={id} />
                <input type="hidden" name="taskId" value={task.id} />
                <ConfirmButton
                  confirmText={`¿Borrar «${task.title}»? Se borran las entregas y, si lleva nota, su columna de la libreta con las notas.`}
                  className="btn-secondary px-3 py-1.5 text-red-700"
                >
                  Borrar
                </ConfirmButton>
              </form>
            </div>
          )}
        </div>
      </div>

      <Card title="Instrucciones">
        <div className="space-y-4 p-4">
          {task.instructions ? (
            <Linkify text={task.instructions} className="text-sm leading-relaxed text-slate-700" />
          ) : (
            <p className="text-sm text-slate-500">Sin instrucciones escritas.</p>
          )}
          {task.attachments.length > 0 && (
            <FileList
              files={task.attachments}
              assignmentId={id}
              taskId={task.id}
              canDelete={detail.canEdit}
            />
          )}
          {detail.canEdit && <TaskAttachmentUpload taskId={task.id} />}
        </div>
      </Card>

      {staffView ? (
        <Card
          title={`Entregas · ${task.stats?.submitted ?? 0} de ${task.stats?.total ?? 0} · ${task.stats?.graded ?? 0} con nota`}
        >
          {all.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">La sección no tiene alumnos.</p>
          ) : (
            <>
              <nav className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm">
                <Link
                  href={`/panel/aula/${id}/tareas/${task.id}`}
                  aria-current={!showAll ? "page" : undefined}
                  className={`rounded-full px-3 py-1 ${!showAll ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Entregaron ({turnedIn.length})
                </Link>
                <Link
                  href={`/panel/aula/${id}/tareas/${task.id}?ver=todos`}
                  aria-current={showAll ? "page" : undefined}
                  className={`rounded-full px-3 py-1 ${showAll ? "bg-brand-600 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  Toda la sección ({all.length})
                </Link>
                {missing.length > 0 && (
                  <span className="text-xs text-slate-500">
                    {missing.length} {missing.length === 1 ? "no ha entregado" : "no han entregado"}
                  </span>
                )}
              </nav>
              {listed.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Nadie ha entregado todavía.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {listed.map((s) => (
                    <li
                      key={s.studentId}
                      className={`space-y-3 px-4 py-4 ${s.submittedAt ? "" : "bg-slate-50/60"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 font-medium text-slate-900">
                          <TurnedInMark done={!!s.submittedAt} files={s.files.length} />
                          {s.studentName}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          {s.submittedAt && <span>Entregó el {shortWhen(s.submittedAt)}</span>}
                          <StatusBadge status={s.status} />
                        </div>
                      </div>
                      {s.text && (
                        <Linkify
                          text={s.text}
                          className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800"
                        />
                      )}
                      {s.files.length > 0 && <FileList files={s.files} assignmentId={id} taskId={task.id} />}
                      {s.submittedByOther && s.submittedByName && (
                        <p className="text-xs text-slate-500">La entregó su familia: {s.submittedByName}</p>
                      )}
                      {detail.canEdit && (
                        <GradeForm assignmentId={id} taskId={task.id} submission={s} max={task.points} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      ) : (
        detail.mine && (
          <Card title="Tu entrega">
            <div className="space-y-4 p-4">
              {detail.students.length > 1 && (
                <nav className="flex flex-wrap gap-2 text-sm">
                  {detail.students.map((st) => (
                    <Link
                      key={st.id}
                      href={`/panel/aula/${id}/tareas/${task.id}?alumno=${st.id}`}
                      className="rounded-full border border-slate-200 px-3 py-1 hover:bg-slate-50"
                    >
                      {st.name}
                    </Link>
                  ))}
                </nav>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detail.mine.status} />
                {detail.mine.submittedAt && (
                  <span className="text-xs text-slate-500">
                    Entregada el {shortWhen(detail.mine.submittedAt)}
                  </span>
                )}
              </div>
              {detail.mine.points !== null && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                  <p className="text-sm text-sky-900">
                    Nota: <strong className="text-lg">{detail.mine.points}</strong>
                    {task.points !== null && <span> de {task.points}</span>}
                  </p>
                  {detail.mine.feedback && (
                    <p className="mt-1 text-sm text-sky-900">Comentario: {detail.mine.feedback}</p>
                  )}
                </div>
              )}
              {detail.mine.files.length > 0 && (
                <FileList
                  files={detail.mine.files}
                  assignmentId={id}
                  taskId={task.id}
                  canDelete={detail.canSubmit && !detail.mine.submittedAt}
                />
              )}
              {!detail.canSubmit && detail.mine.status === "vencida" && (
                <p className="text-sm text-red-700">
                  La fecha de entrega ya pasó y esta tarea no acepta entregas tarde.
                </p>
              )}
              <SubmissionForm
                assignmentId={id}
                taskId={task.id}
                alumno={detail.viewer === "familia" ? (alumno ?? detail.students[0]?.id ?? null) : null}
                mine={detail.mine}
                canSubmit={detail.canSubmit}
              />
            </div>
          </Card>
        )
      )}
    </div>
  );
}

function FileList({
  files,
  assignmentId,
  taskId,
  canDelete = false,
}: {
  files: TaskFileDto[];
  assignmentId: string;
  taskId: string;
  canDelete?: boolean;
}) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2">
          <a
            href={`/panel/aula/tareas/archivo/${f.id}`}
            target="_blank"
            rel="noopener"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
          >
            {f.contentType.startsWith("image/") ? (
              // biome-ignore lint/performance/noImgElement: la imagen la entrega el servicio con su sesión
              <img
                src={`/panel/aula/tareas/archivo/${f.id}`}
                alt=""
                loading="lazy"
                className="size-10 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-xs font-bold text-brand-700">
                {f.contentType === "application/pdf" ? "PDF" : "DOC"}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900">{f.name}</span>
              <span className="block text-xs text-slate-500">{formatFileSize(f.size)}</span>
            </span>
          </a>
          {canDelete && (
            <form action={deleteTaskFileAction}>
              <input type="hidden" name="assignmentId" value={assignmentId} />
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="fileId" value={f.id} />
              <ConfirmButton
                confirmText={`¿Quitar «${f.name}»?`}
                className="text-xs font-semibold text-slate-500 hover:text-red-700"
              >
                Quitar
              </ConfirmButton>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Marca a simple vista si el alumno entregó (y cuántos archivos subió). */
function TurnedInMark({ done, files }: { done: boolean; files: number }) {
  return done ? (
    <span
      title={files > 0 ? `Entregó ${files} ${files === 1 ? "archivo" : "archivos"}` : "Entregó"}
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
    >
      <svg viewBox="0 0 20 20" className="size-3.5" fill="currentColor" aria-hidden="true">
        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" />
      </svg>
      Entregó{files > 0 ? ` · ${files} ${files === 1 ? "archivo" : "archivos"}` : ""}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
      Sin entregar
    </span>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
        {title}
      </h2>
      {children}
    </section>
  );
}
