import {
  type ClassQuizDetailDto,
  currentPeriod,
  QUESTION_KIND_LABELS,
  QUIZ_STATUS_LABELS,
  type QuizQuestionDto,
  type QuizStatus,
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
import { deleteQuestionAction, deleteQuizAction, startQuizAction } from "../../../actions";
import { ConfirmButton } from "../../class-editor";
import { AddQuestion, EditQuestion, EditQuiz, PublishButton, QuizTaker, ReviewForm } from "../quiz-forms";

export const metadata: Metadata = { title: "Examen" };

const when = (iso: string) =>
  new Intl.DateTimeFormat("es-HN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Tegucigalpa",
  }).format(new Date(iso));

const QUIZ_STYLES: Record<QuizStatus, string> = {
  proximo: "bg-slate-100 text-slate-700",
  disponible: "bg-brand-50 text-brand-700",
  en_curso: "bg-amber-50 text-amber-900",
  entregado: "bg-amber-100 text-amber-900",
  calificado: "bg-sky-50 text-sky-800",
  cerrado: "bg-red-50 text-red-800",
};

/** Lo mismo, dicho para el maestro (de un alumno, no de «ti»). */
const TEACHER_LABELS: Record<QuizStatus, string> = {
  proximo: "Todavía no abre",
  disponible: "Sin presentar",
  en_curso: "Lo está resolviendo",
  entregado: "Falta revisar",
  calificado: "Calificado",
  cerrado: "No lo presentó",
};

function QuizBadge({ status, teacher = false }: { status: QuizStatus; teacher?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${QUIZ_STYLES[status]}`}
    >
      {teacher ? TEACHER_LABELS[status] : QUIZ_STATUS_LABELS[status]}
    </span>
  );
}

/** Un examen: el maestro lo arma, lo publica y revisa; el alumno (o su familia) lo presenta. */
export default async function QuizPage({
  params,
  searchParams,
}: PageProps<"/panel/aula/[id]/examenes/[quizId]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria", "estudiante", "padre");
  const { id, quizId } = await params;
  const query = await searchParams;
  const alumno =
    typeof query.alumno === "string" && /^[0-9a-f-]{36}$/i.test(query.alumno) ? query.alumno : undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(quizId)) notFound();
  const detail = await academic.quiz(session.accessToken, quizId, alumno).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const { quiz } = detail;
  if (quiz.assignmentId !== id) notFound();
  const periods = detail.canEdit ? (await academic.periods(session.accessToken)).periods : [];
  const current = currentPeriod(periods, todayInHonduras());

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/panel/aula/${id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← {detail.subjectName} · {detail.sectionLabel}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {quiz.title}{" "}
              {!quiz.published && (
                <span className="align-middle text-xs font-semibold text-amber-700">· borrador</span>
              )}
            </h1>
            <p className="text-sm text-slate-500">
              Abre {when(quiz.opensAt)} · cierra {when(quiz.closesAt)}
              {quiz.timeLimitMinutes && ` · ${quiz.timeLimitMinutes} minutos para resolverlo`}
            </p>
            <p className="text-sm text-slate-500">
              {quiz.questionCount} {quiz.questionCount === 1 ? "pregunta" : "preguntas"} · {quiz.rawPoints}{" "}
              puntos
              {quiz.points !== null && ` · vale ${quiz.points} en la libreta (${quiz.periodName ?? ""})`}
            </p>
          </div>
          {detail.canEdit && (
            <div className="flex flex-wrap items-start gap-2">
              <EditQuiz
                assignmentId={id}
                periods={periods}
                currentPeriodId={current?.id ?? null}
                quiz={quiz}
              />
              <form action={deleteQuizAction}>
                <input type="hidden" name="assignmentId" value={id} />
                <input type="hidden" name="quizId" value={quiz.id} />
                <ConfirmButton
                  confirmText={`¿Borrar «${quiz.title}»? Se borran los intentos y, si lleva nota, su columna de la libreta.`}
                  className="btn-secondary px-3 py-1.5 text-red-700"
                >
                  Borrar
                </ConfirmButton>
              </form>
            </div>
          )}
        </div>
        {quiz.instructions && <Linkify text={quiz.instructions} className="mt-3 text-sm text-slate-700" />}
      </div>

      {detail.attempts !== null ? (
        <TeacherView detail={detail} assignmentId={id} />
      ) : (
        <StudentView detail={detail} assignmentId={id} alumno={alumno ?? null} />
      )}
    </div>
  );
}

function TeacherView({ detail, assignmentId }: { detail: ClassQuizDetailDto; assignmentId: string }) {
  const { quiz } = detail;
  const started = (detail.attempts ?? []).some((a) => a.startedAt);
  const openQuestions = detail.questions.filter((q) => q.kind === "abierta");
  return (
    <>
      {detail.canEdit && (
        <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-600">
            {quiz.published
              ? "Publicado: los alumnos lo ven y lo presentan entre la fecha de apertura y la de cierre."
              : "En borrador: agrega las preguntas y publícalo cuando esté listo. Los alumnos todavía no lo ven."}
          </p>
          {(!quiz.published || !started) && <PublishButton assignmentId={assignmentId} quiz={quiz} />}
        </section>
      )}

      <Card
        title={`Preguntas · ${detail.questions.length}`}
        action={
          detail.canEdit && !started ? <AddQuestion assignmentId={assignmentId} quizId={quiz.id} /> : null
        }
      >
        {detail.questions.length === 0 ? (
          <Empty>Sin preguntas todavía.</Empty>
        ) : (
          <ol className="divide-y divide-slate-100">
            {detail.questions.map((q, i) => (
              <li key={q.id} className="space-y-2 px-4 py-3">
                <QuestionView question={q} index={i} />
                {detail.canEdit && !started && (
                  <div className="flex items-center gap-3">
                    <EditQuestion assignmentId={assignmentId} quizId={quiz.id} question={q} />
                    <form action={deleteQuestionAction}>
                      <input type="hidden" name="assignmentId" value={assignmentId} />
                      <input type="hidden" name="quizId" value={quiz.id} />
                      <input type="hidden" name="questionId" value={q.id} />
                      <ConfirmButton
                        confirmText="¿Quitar esta pregunta?"
                        className="text-xs font-semibold text-slate-500 hover:text-red-700"
                      >
                        Quitar
                      </ConfirmButton>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {started && detail.canEdit && (
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Ya hay alumnos que empezaron: las preguntas no se pueden cambiar.
          </p>
        )}
      </Card>

      {quiz.published && (
        <Card
          title={`Resultados · ${quiz.stats?.submitted ?? 0} de ${quiz.stats?.total ?? 0} entregaron · ${quiz.stats?.graded ?? 0} calificados`}
        >
          <ul className="divide-y divide-slate-100">
            {(detail.attempts ?? []).map((a) => (
              <li key={a.studentId} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{a.studentName}</p>
                  <div className="flex items-center gap-3">
                    {a.score !== null && (
                      <span className="text-sm font-semibold text-slate-900">
                        {a.score}
                        <span className="font-normal text-slate-500"> / {quiz.points ?? quiz.rawPoints}</span>
                      </span>
                    )}
                    <QuizBadge status={a.status} teacher />
                  </div>
                </div>
                {a.submittedAt && (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">
                      {a.pendingReview ? "Revisar respuestas abiertas" : "Ver respuestas"}
                    </summary>
                    <div className="mt-3 space-y-3">
                      <AnswersView detail={detail} answers={a.answers} />
                      {detail.canEdit && openQuestions.length > 0 && (
                        <ReviewForm
                          assignmentId={assignmentId}
                          quizId={quiz.id}
                          attempt={a}
                          openQuestions={openQuestions}
                        />
                      )}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function StudentView({
  detail,
  assignmentId,
  alumno,
}: {
  detail: ClassQuizDetailDto;
  assignmentId: string;
  alumno: string | null;
}) {
  const { quiz, mine } = detail;
  if (!mine) return null;
  const familyStudent = detail.viewer === "familia" ? (alumno ?? detail.students[0]?.id ?? null) : null;
  return (
    <>
      {detail.students.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {detail.students.map((st) => (
            <Link
              key={st.id}
              href={`/panel/aula/${assignmentId}/examenes/${quiz.id}?alumno=${st.id}`}
              className="rounded-full border border-slate-200 px-3 py-1 hover:bg-slate-50"
            >
              {st.name}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex items-center gap-2">
        <QuizBadge status={mine.status} />
      </div>

      {mine.status === "disponible" && (
        <section className="card space-y-3 p-4">
          <p className="text-sm text-slate-700">
            {quiz.timeLimitMinutes
              ? `Al empezar tendrás ${quiz.timeLimitMinutes} minutos. El reloj no se detiene aunque cierres la página.`
              : "Puedes responderlo hasta que cierre. Tus respuestas se guardan solas."}{" "}
            Se presenta una sola vez.
          </p>
          <form action={startQuizAction}>
            <input type="hidden" name="assignmentId" value={assignmentId} />
            <input type="hidden" name="quizId" value={quiz.id} />
            {familyStudent && <input type="hidden" name="alumno" value={familyStudent} />}
            <button type="submit" className="btn-primary">
              Comenzar examen
            </button>
          </form>
        </section>
      )}

      {mine.status === "en_curso" && mine.deadline && (
        <QuizTaker
          assignmentId={assignmentId}
          quizId={quiz.id}
          alumno={familyStudent}
          questions={detail.questions}
          initial={Object.fromEntries(
            mine.answers
              .filter((a) => a.answer !== null)
              .map((a) => [a.questionId, a.answer as number | boolean | string]),
          )}
          deadline={mine.deadline}
        />
      )}

      {(mine.status === "entregado" || mine.status === "calificado") && (
        <section className="card space-y-3 p-4">
          {mine.status === "calificado" ? (
            <p className="text-sm text-sky-900">
              Nota: <strong className="text-lg">{mine.score}</strong> de {quiz.points ?? quiz.rawPoints}
            </p>
          ) : (
            <p className="text-sm text-slate-700">
              Entregado. Tu maestro está revisando las respuestas abiertas; la nota aparece aquí cuando
              termine.
            </p>
          )}
          {detail.questions.length > 0 && <AnswersView detail={detail} answers={mine.answers} />}
          {new Date(quiz.closesAt) > new Date() && (
            <p className="text-xs text-slate-500">Las respuestas correctas se ven cuando el examen cierre.</p>
          )}
        </section>
      )}

      {mine.status === "proximo" && (
        <p className="card p-4 text-sm text-slate-600">El examen abre {when(quiz.opensAt)}.</p>
      )}
      {mine.status === "cerrado" && (
        <p className="card p-4 text-sm text-red-700">El examen cerró y no se presentó.</p>
      )}
    </>
  );
}

function QuestionView({ question: q, index }: { question: QuizQuestionDto; index: number }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-slate-900">
        <span className="mr-1 text-slate-400">{index + 1}.</span>
        <span className="whitespace-pre-wrap">{q.prompt}</span>
        <span className="ml-2 text-xs font-normal text-slate-500">
          {QUESTION_KIND_LABELS[q.kind]} · {q.points} pts
        </span>
      </p>
      {q.kind === "opcion" && (
        <ul className="space-y-0.5 pl-5 text-sm">
          {q.options.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: las opciones no cambian de orden
            <li key={i} className={q.correct === i ? "font-semibold text-brand-700" : "text-slate-700"}>
              {q.correct === i ? "✓ " : "• "}
              {o}
            </li>
          ))}
        </ul>
      )}
      {q.kind === "vf" && q.correct !== null && (
        <p className="pl-5 text-sm font-semibold text-brand-700">✓ {q.correct ? "Verdadero" : "Falso"}</p>
      )}
    </div>
  );
}

/** Cada respuesta con sus puntos (y la correcta, si se puede ver). */
function AnswersView({
  detail,
  answers,
}: {
  detail: ClassQuizDetailDto;
  answers: Array<{ questionId: string; answer: number | boolean | string | null; points: number | null }>;
}) {
  return (
    <ol className="space-y-2">
      {detail.questions.map((q, i) => {
        const a = answers.find((x) => x.questionId === q.id);
        const shown =
          a?.answer === null || a?.answer === undefined || a.answer === ""
            ? "(en blanco)"
            : q.kind === "opcion"
              ? (q.options[a.answer as number] ?? "—")
              : q.kind === "vf"
                ? a.answer
                  ? "Verdadero"
                  : "Falso"
                : String(a.answer);
        const correct =
          q.correct === null
            ? null
            : q.kind === "opcion"
              ? q.options[q.correct as number]
              : q.correct
                ? "Verdadero"
                : "Falso";
        return (
          <li key={q.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">
              {i + 1}. {q.prompt}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">Respuesta: {shown}</p>
            {correct !== null && q.kind !== "abierta" && (
              <p className="text-brand-700">Correcta: {correct}</p>
            )}
            <p className="text-xs text-slate-500">
              {a?.points === null || a?.points === undefined
                ? "Sin revisar"
                : `${a.points} de ${q.points} pts`}
            </p>
          </li>
        );
      })}
    </ol>
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
