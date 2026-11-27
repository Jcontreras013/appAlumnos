import {
  type ClassPostDto,
  type ClassroomDto,
  currentPeriod,
  QUIZ_STATUS_LABELS,
  todayInHonduras,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Linkify } from "@/components/linkify";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { deleteClassMaterialAction, deleteClassPostAction, moveTopicAction } from "../actions";
import { PublishBadge, StatusBadge } from "../status-badge";
import { AddMaterial, ConfirmButton, EditPost, MeetingForm, NewPost } from "./class-editor";
import { NewQuiz } from "./examenes/quiz-forms";
import { MaterialView } from "./material-view";
import { NewTask } from "./tareas/task-forms";

export const metadata: Metadata = { title: "Clase" };

const when = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  }).format(new Date(iso));

/**
 * La página de una clase (aula virtual): enlace de la clase en línea, avisos y temas con su
 * explicación y materiales. El maestro publica aquí; el alumno y su familia lo ven.
 */
export default async function ClassPage({ params }: PageProps<"/panel/aula/[id]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria", "estudiante", "padre");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const room = await academic.classroom(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const edit = room.canEdit;
  const periods = edit ? (await academic.periods(session.accessToken)).periods : [];
  const current = currentPeriod(periods, todayInHonduras());
  const now = new Date();
  // Chat de la clase: el maestro, los alumnos y la dirección (las familias no lo ven).
  const chat =
    room.viewer === "familia" ? null : await academic.classChat(session.accessToken, id).catch(() => null);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/aula" className="text-sm text-slate-500 hover:text-slate-900">
          ← {room.viewer === "alumno" ? "Mis clases" : "Aula virtual"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{room.subjectName}</h1>
        <p className="text-sm text-slate-500">
          {room.sectionLabel} · {room.teacherName}
        </p>
      </div>

      <OnlineClass room={room} />

      <Card
        title="Tareas"
        action={
          edit ? (
            <NewTask
              assignmentId={room.assignmentId}
              classDays={room.classDays}
              periods={periods}
              currentPeriodId={current?.id ?? null}
            />
          ) : null
        }
      >
        {room.tasks.length === 0 ? (
          <Empty>{edit ? "Publica una tarea: los alumnos la entregan aquí." : "Sin tareas por ahora."}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {room.tasks.map((t) => {
              const overdue = new Date(t.dueAt) < now;
              return (
                <li key={t.id}>
                  <Link
                    href={`/panel/aula/${room.assignmentId}/tareas/${t.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {t.title}
                        <PublishBadge task={t} />
                      </span>
                      <span className={`block text-xs ${overdue ? "text-slate-500" : "text-brand-700"}`}>
                        {overdue ? "Venció" : "Entrega"} {when(t.dueAt)}
                        {t.points !== null && ` · ${t.points} pts`}
                      </span>
                    </span>
                    {t.stats ? (
                      <span className="text-xs text-slate-500">
                        {t.stats.submitted} de {t.stats.total} entregaron · {t.stats.graded} con nota
                      </span>
                    ) : t.status ? (
                      <span className="flex items-center gap-2">
                        {t.myPoints !== null && (
                          <span className="text-sm font-semibold text-slate-900">
                            {t.myPoints}
                            {t.points !== null && (
                              <span className="font-normal text-slate-500"> / {t.points}</span>
                            )}
                          </span>
                        )}
                        <StatusBadge status={t.status} />
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Exámenes"
        action={
          edit ? (
            <NewQuiz
              assignmentId={room.assignmentId}
              periods={periods}
              currentPeriodId={current?.id ?? null}
            />
          ) : null
        }
      >
        {room.quizzes.length === 0 ? (
          <Empty>
            {edit ? "Arma un examen: se califica solo y la nota va a la libreta." : "Sin exámenes por ahora."}
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {room.quizzes.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/panel/aula/${room.assignmentId}/examenes/${q.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">
                      {q.title}
                      {!q.published && (
                        <span className="ml-2 text-xs font-semibold text-amber-700">borrador</span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500">
                      Abre {when(q.opensAt)} · cierra {when(q.closesAt)}
                      {q.timeLimitMinutes && ` · ${q.timeLimitMinutes} min`}
                      {q.points !== null && ` · ${q.points} pts`}
                    </span>
                  </span>
                  {q.stats ? (
                    <span className="text-xs text-slate-500">
                      {q.stats.submitted} de {q.stats.total} lo presentaron · {q.stats.graded} calificados
                    </span>
                  ) : q.status ? (
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      {q.myScore !== null && (
                        <span className="text-sm text-slate-900">
                          {q.myScore}
                          {q.points !== null && (
                            <span className="font-normal text-slate-500"> / {q.points}</span>
                          )}
                        </span>
                      )}
                      {QUIZ_STATUS_LABELS[q.status]}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Avisos de la clase"
        action={edit ? <NewPost assignmentId={room.assignmentId} kind="aviso" /> : null}
      >
        {room.announcements.length === 0 ? (
          <Empty>Sin avisos.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {room.announcements.map((a) => (
              <li key={a.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-slate-900">{a.title}</p>
                  <span className="text-xs text-slate-500">
                    {a.authorName} · {when(a.createdAt)}
                  </span>
                </div>
                {a.body && <Linkify text={a.body} className="text-sm text-slate-700" />}
                {edit && <PostActions room={room} post={a} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {chat && (
        // El chat tiene su propio apartado («Chats»): aquí, el acceso directo.
        <Link
          href={`/panel/chats/${room.assignmentId}`}
          className="card flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
        >
          <span className="text-sm font-semibold text-slate-700">
            Chat de la clase{" "}
            <span
              className={`ml-1 rounded-full px-2 py-0.5 text-xs ${chat.enabled ? "bg-brand-50 text-brand-700" : "bg-slate-200 text-slate-600"}`}
            >
              {chat.enabled ? "Abierto" : "Cerrado"}
            </span>
          </span>
          <span className="text-sm font-medium text-brand-700">Abrir el chat →</span>
        </Link>
      )}

      <Card title="Temas" action={edit ? <NewPost assignmentId={room.assignmentId} kind="tema" /> : null}>
        {room.topics.length === 0 ? (
          <Empty>
            {edit
              ? "Publica el primer tema: explícalo y agrega videos, guías o enlaces."
              : "El maestro todavía no ha publicado temas."}
          </Empty>
        ) : (
          <ol className="divide-y divide-slate-100">
            {room.topics.map((t, index) => (
              <li key={t.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    <span className="mr-2 text-slate-400">{index + 1}.</span>
                    {t.title}
                  </h3>
                  {edit && <MoveButtons room={room} index={index} />}
                </div>
                {t.body && <Linkify text={t.body} className="text-sm leading-relaxed text-slate-700" />}
                {t.materials.length > 0 && (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {t.materials.map((m) => (
                      <li key={m.id} className={m.kind === "video" ? "sm:col-span-2" : ""}>
                        <MaterialView material={m} />
                        {edit && (
                          <form action={deleteClassMaterialAction} className="mt-1">
                            <input type="hidden" name="assignmentId" value={room.assignmentId} />
                            <input type="hidden" name="materialId" value={m.id} />
                            <ConfirmButton
                              confirmText={`¿Quitar «${m.title}» del tema?`}
                              className="text-xs font-semibold text-slate-500 hover:text-red-700"
                            >
                              Quitar
                            </ConfirmButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {edit && (
                  <div className="space-y-2">
                    <AddMaterial assignmentId={room.assignmentId} postId={t.id} />
                    <PostActions room={room} post={t} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function OnlineClass({ room }: { room: ClassroomDto }) {
  if (!room.meetingUrl && !room.canEdit) return null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Clase en línea</h2>
          <p className="text-sm text-slate-500">
            {room.meetingUrl
              ? (room.meetingNote ?? "Entra a la hora de la clase.")
              : "Sin enlace. Pega el de Meet, Zoom o Jitsi para que los alumnos entren desde aquí."}
          </p>
        </div>
        {room.meetingUrl && (
          <a href={room.meetingUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Entrar a la clase
          </a>
        )}
      </div>
      {room.canEdit && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">
            {room.meetingUrl ? "Cambiar el enlace" : "Poner el enlace"}
          </summary>
          <div className="mt-3">
            <MeetingForm
              assignmentId={room.assignmentId}
              meetingUrl={room.meetingUrl}
              meetingNote={room.meetingNote}
            />
          </div>
        </details>
      )}
    </section>
  );
}

function PostActions({ room, post }: { room: ClassroomDto; post: ClassPostDto }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <EditPost assignmentId={room.assignmentId} post={post} />
      <form action={deleteClassPostAction}>
        <input type="hidden" name="assignmentId" value={room.assignmentId} />
        <input type="hidden" name="postId" value={post.id} />
        <ConfirmButton
          confirmText={
            post.kind === "tema"
              ? `¿Borrar el tema «${post.title}» con todos sus materiales?`
              : `¿Borrar el aviso «${post.title}»?`
          }
          className="text-xs font-semibold text-slate-500 hover:text-red-700"
        >
          Borrar
        </ConfirmButton>
      </form>
    </div>
  );
}

/** Subir o bajar un tema: manda el orden completo con los dos intercambiados. */
function MoveButtons({ room, index }: { room: ClassroomDto; index: number }) {
  const ids = room.topics.map((t) => t.id);
  const swapped = (a: number, b: number) => {
    const next = [...ids];
    [next[a], next[b]] = [next[b] as string, next[a] as string];
    return next.join(",");
  };
  return (
    <div className="flex gap-1">
      {index > 0 && (
        <form action={moveTopicAction}>
          <input type="hidden" name="assignmentId" value={room.assignmentId} />
          <input type="hidden" name="order" value={swapped(index, index - 1)} />
          <button type="submit" className="btn-secondary px-2 py-1 text-xs" aria-label="Subir tema">
            ↑
          </button>
        </form>
      )}
      {index < ids.length - 1 && (
        <form action={moveTopicAction}>
          <input type="hidden" name="assignmentId" value={room.assignmentId} />
          <input type="hidden" name="order" value={swapped(index, index + 1)} />
          <button type="submit" className="btn-secondary px-2 py-1 text-xs" aria-label="Bajar tema">
            ↓
          </button>
        </form>
      )}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-6 text-center text-sm text-slate-500">{children}</p>
);
