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
import { StatusBadge } from "../../../status-badge";
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

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/panel/aula/${id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← {detail.subjectName} · {detail.sectionLabel}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{task.title}</h1>
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
          {detail.submissions?.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">La sección no tiene alumnos.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {detail.submissions?.map((s) => (
                <li key={s.studentId} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{s.studentName}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      {s.submittedAt && <span>{shortWhen(s.submittedAt)}</span>}
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
