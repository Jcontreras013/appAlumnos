import {
  formatLempiras,
  isRegionalRole,
  type PlanBoardDto,
  ROLE_LABELS,
  type SchoolFollowUpDto,
  type TeacherTodayDto,
} from "@escolar/shared";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { academic } from "@/lib/academic";
import { getSession } from "@/lib/dal";
import { identity } from "@/lib/identity";

export const metadata: Metadata = { title: "Inicio" };

/** «jueves 27 de noviembre», en hora de Honduras. */
const todayLabel = () => {
  const text = new Intl.DateTimeFormat("es-HN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Tegucigalpa",
  }).format(new Date());
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * Inicio: lo que cada quien tiene que hacer hoy. La dirección, la coordinación y la secretaría ven los
 * pendientes del centro (asistencia, planificaciones, solicitudes, alumnos en riesgo, cobros vencidos);
 * el maestro, sus clases de hoy, la planificación de la semana y lo que tiene por calificar.
 */
export default async function PanelHome() {
  const { user, accessToken, mfa } = await getSession();
  // Las direcciones departamental y distrital empiezan en su tablero de centros.
  // Mientras falte activar la verificación en dos pasos, el panel (el layout) la pide aquí.
  if (isRegionalRole(user.role) && !mfa.setupRequired) redirect("/panel/region");
  // Las familias van directo a ver a sus hijos.
  if (user.role === "padre" && !user.mustChangePassword) redirect("/panel/familia");
  // Los alumnos, a su aula virtual.
  if (user.role === "estudiante" && !user.mustChangePassword) redirect("/panel/aula");
  const firstName = user.name.split(" ")[0];
  const greeting = (
    <div>
      <p className="text-sm font-medium text-brand-700">{todayLabel()}</p>
      <h1 className="mt-0.5 text-2xl font-semibold text-slate-900">Hola, {firstName}</h1>
      <p className="mt-1 text-sm text-slate-500">{ROLE_LABELS[user.role]}</p>
    </div>
  );

  if (user.role === "superadmin") {
    const schools = await identity.listSchools(accessToken);
    const active = schools.filter((s) => s.active).length;
    return (
      <div className="space-y-6">
        {greeting}
        <div className="grid gap-4 sm:grid-cols-3">
          <Tile icon="building" title="Colegios activos" value={String(active)} href="/panel/colegios" />
          <Tile
            icon="building"
            title="Colegios desactivados"
            value={String(schools.length - active)}
            href="/panel/colegios"
          />
        </div>
      </div>
    );
  }

  const office = user.role === "admin" || user.role === "coordinador" || user.role === "secretaria";
  const teaches = user.role === "docente" || user.role === "admin" || user.role === "coordinador";
  const [follow, board, requests, balances, today, myPlans] = await Promise.all([
    office ? academic.followUp(accessToken).catch(() => null) : null,
    office ? academic.planBoard(accessToken).catch(() => null) : null,
    user.role === "admin" ? academic.pendingChangeRequests(accessToken).catch(() => null) : null,
    user.role === "admin" || user.role === "secretaria"
      ? academic.balances(accessToken).catch(() => null)
      : null,
    teaches ? academic.teacherToday(accessToken).catch(() => null) : null,
    user.role === "docente" ? academic.myPlans(accessToken).catch(() => null) : null,
  ]);

  return (
    <div className="space-y-8">
      {greeting}
      {office && follow && (
        <OfficeToday
          follow={follow}
          board={board}
          requests={requests?.count ?? 0}
          overdue={balances ? balances.reduce((sum, b) => sum + b.overdueCents, 0) : null}
          overdueStudents={balances ? balances.filter((b) => b.overdueCents > 0).length : 0}
          canPay={user.role !== "coordinador"}
        />
      )}
      {today && (today.classes.length > 0 || user.role === "docente") && <TeacherToday today={today} />}
      {myPlans && <WeekPlans board={myPlans} />}
      {today && today.toGrade.length > 0 && <ToGrade today={today} />}
      <QuickActions role={user.role} />
    </div>
  );
}

// ───────────────────────────── Dirección, coordinación y secretaría ─────────────────────────────

function OfficeToday({
  follow,
  board,
  requests,
  overdue,
  overdueStudents,
  canPay,
}: {
  follow: SchoolFollowUpDto;
  board: PlanBoardDto | null;
  requests: number;
  overdue: number | null;
  overdueStudents: number;
  canPay: boolean;
}) {
  const { attendance, plans } = follow;
  const missing = attendance.sections - attendance.sectionsRecordedToday;
  const toReview = board?.totals.enviada ?? 0;
  const atRisk = follow.studentsAtRisk.length;
  return (
    <section className="space-y-3">
      <SectionTitle>Hoy en el centro</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {attendance.dayOff ? (
          <Tile
            icon="calendar"
            title="Hoy no hay clases"
            value={attendance.dayOff.name}
            href="/panel/calendario"
          />
        ) : (
          <Tile
            icon="clipboard"
            title="Asistencia de hoy"
            value={`${attendance.sectionsRecordedToday} de ${attendance.sections}`}
            detail={
              missing > 0
                ? `${missing} ${missing === 1 ? "sección sin pasar" : "secciones sin pasar"}`
                : "Todas las secciones al día"
            }
            tone={missing > 0 ? "warn" : "ok"}
            href="/panel/seguimiento"
          />
        )}
        <Tile
          icon="planner"
          title="Planificaciones por revisar"
          value={String(toReview)}
          detail={
            plans.overdue > 0
              ? `${plans.overdue} sin entregar y con el plazo vencido`
              : `${plans.delivered} de ${plans.total} entregadas esta semana`
          }
          tone={toReview > 0 || plans.overdue > 0 ? "warn" : "ok"}
          href="/panel/planificacion"
        />
        <Tile
          icon="alert"
          title="Alumnos en riesgo"
          value={String(atRisk)}
          detail={atRisk ? "Por notas o por asistencia" : "Ninguno por ahora"}
          tone={atRisk ? "bad" : "ok"}
          href="/panel/seguimiento"
        />
        {requests > 0 && (
          <Tile
            icon="inbox"
            title="Solicitudes de secretaría"
            value={String(requests)}
            detail="Esperan tu confirmación"
            tone="warn"
            href="/panel/solicitudes"
          />
        )}
        {canPay && overdue !== null && (
          <Tile
            icon="wallet"
            title="Cobros vencidos"
            value={formatLempiras(overdue)}
            detail={
              overdueStudents
                ? `${overdueStudents} ${overdueStudents === 1 ? "alumno" : "alumnos"} con saldo vencido`
                : "Nadie con saldo vencido"
            }
            tone={overdue > 0 ? "bad" : "ok"}
            href="/panel/pagos"
          />
        )}
        {follow.period && follow.daysToClose !== null && follow.daysToClose >= 0 && (
          <Tile
            icon="grades"
            title={`Cierre de notas · ${follow.period.name}`}
            value={
              follow.daysToClose === 0
                ? "Hoy"
                : `${follow.daysToClose} ${follow.daysToClose === 1 ? "día" : "días"}`
            }
            detail={`${follow.gradeProgress.complete} de ${follow.gradeProgress.total} clases con las notas completas`}
            tone={
              follow.daysToClose <= 3 && follow.gradeProgress.complete < follow.gradeProgress.total
                ? "warn"
                : undefined
            }
            href="/panel/seguimiento"
          />
        )}
      </div>
    </section>
  );
}

// ───────────────────────────── El maestro ─────────────────────────────

function TeacherToday({ today }: { today: TeacherTodayDto }) {
  return (
    <section className="space-y-3">
      <SectionTitle>Tus clases de hoy</SectionTitle>
      {today.dayOff ? (
        <p className="card flex items-center gap-3 p-4 text-sm text-slate-600">
          <Icon name="calendar" className="size-5 text-brand-600" />
          Hoy no hay clases: {today.dayOff.name}.
        </p>
      ) : today.classes.length === 0 ? (
        <p className="card p-4 text-sm text-slate-500">Hoy no tienes clases en tu horario.</p>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {today.classes.map((c) => (
            <li key={`${c.assignmentId}-${c.startsAt}`} className="flex flex-wrap items-center gap-3 p-4">
              {c.startsAt && (
                <div className="w-14 shrink-0 text-sm tabular-nums text-slate-500">
                  <span className="block font-semibold text-slate-900">{c.startsAt}</span>
                  {c.endsAt}
                </div>
              )}
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-medium text-slate-900">{c.subjectName}</p>
                <p className="truncate text-sm text-slate-500">
                  {c.sectionLabel}
                  {c.substituting && " · cubres como sustituto"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.attendanceTaken ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                    <Icon name="check" className="size-3.5" /> Asistencia
                  </span>
                ) : (
                  <Link
                    href={`/panel/cuaderno/asistencia/${c.sectionId}` as Route}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    Pasar asistencia
                  </Link>
                )}
                <Link
                  href={`/panel/cuaderno/notas/${c.assignmentId}` as Route}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  Notas
                </Link>
                <Link
                  href={`/panel/aula/${c.assignmentId}` as Route}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  Aula
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WeekPlans({ board }: { board: PlanBoardDto }) {
  if (!board.rows.length) return null;
  const { totals } = board;
  const toDo = totals.sin_iniciar + totals.borrador + totals.devuelta;
  return (
    <section className="space-y-3">
      <SectionTitle>Planificación de la semana</SectionTitle>
      <Link
        href="/panel/planificacion"
        className="card flex flex-wrap items-center gap-4 p-4 transition hover:border-brand-500"
      >
        <span
          className={`grid size-11 place-items-center rounded-xl ${toDo ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}`}
        >
          <Icon name="planner" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">
            {board.dayOff
              ? "Semana sin clases: no se pide planificación"
              : toDo
                ? `${toDo} ${toDo === 1 ? "clase por planificar" : "clases por planificar"}`
                : "Todo entregado"}
          </p>
          <p className="text-sm text-slate-500">
            {totals.devuelta > 0 &&
              `${totals.devuelta} devuelta${totals.devuelta === 1 ? "" : "s"} con observaciones · `}
            {totals.enviada} en revisión · {totals.aprobada} aprobada{totals.aprobada === 1 ? "" : "s"}
            {totals.atrasadas > 0 && ` · ${totals.atrasadas} atrasada${totals.atrasadas === 1 ? "" : "s"}`}
          </p>
        </div>
        <Icon name="arrow" className="size-5 text-slate-400" />
      </Link>
    </section>
  );
}

function ToGrade({ today }: { today: TeacherTodayDto }) {
  return (
    <section className="space-y-3">
      <SectionTitle>Por calificar</SectionTitle>
      <ul className="card divide-y divide-slate-100">
        {today.toGrade.map((t) => (
          <li key={t.taskId}>
            <Link
              href={`/panel/aula/${t.assignmentId}/tareas/${t.taskId}` as Route}
              className="flex items-center gap-3 p-4 hover:bg-slate-50"
            >
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-amber-100 px-2 text-xs font-bold text-amber-800">
                {t.pending}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{t.title}</span>
                <span className="block truncate text-sm text-slate-500">{t.label}</span>
              </span>
              <Icon name="arrow" className="size-5 text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────────── Accesos directos ─────────────────────────────

function QuickActions({ role }: { role: string }) {
  const actions: Array<{ href: Route; label: string; icon: IconName }> = [];
  if (role === "admin" || role === "secretaria") {
    actions.push({ href: "/panel/alumnos/nuevo" as Route, label: "Nuevo alumno", icon: "users" });
    actions.push({ href: "/panel/pagos", label: "Registrar pago", icon: "wallet" });
  }
  if (role === "docente") {
    actions.push({ href: "/panel/cuaderno", label: "Asistencia y notas", icon: "clipboard" });
    actions.push({ href: "/panel/aula", label: "Aula virtual", icon: "book" });
  }
  if (role === "coordinador")
    actions.push({ href: "/panel/planificacion", label: "Revisar planificaciones", icon: "planner" });
  if (role !== "coordinador") actions.push({ href: "/panel/mensajes", label: "Mensajes", icon: "message" });
  actions.push({ href: "/panel/avisos", label: "Publicar aviso", icon: "megaphone" });
  actions.push({ href: "/panel/horario", label: "Horario", icon: "clock" });
  return (
    <section className="space-y-3">
      <SectionTitle>Accesos directos</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="card flex flex-col items-center gap-2 p-4 text-center text-sm font-medium text-slate-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name={a.icon} className="size-5" />
            </span>
            {a.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────────── Piezas ─────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{children}</h2>;
}

const TONES = {
  ok: "bg-brand-50 text-brand-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
  none: "bg-slate-100 text-slate-600",
} as const;

function Tile({
  icon,
  title,
  value,
  detail,
  tone,
  href,
}: {
  icon: IconName;
  title: string;
  value: string;
  detail?: string;
  tone?: keyof typeof TONES;
  href: Route;
}) {
  return (
    <Link
      href={href}
      className="card flex items-start gap-3 p-4 transition hover:border-brand-500 hover:shadow-md"
    >
      <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${TONES[tone ?? "none"]}`}>
        <Icon name={icon} className="size-6" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-slate-500">{title}</span>
        <span className="block truncate text-xl font-semibold tabular-nums text-slate-900">{value}</span>
        {detail && <span className="block text-xs text-slate-500">{detail}</span>}
      </span>
    </Link>
  );
}
