import { isIsoDate, todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";
import { AttendanceSheet } from "./attendance-sheet";

export const metadata: Metadata = { title: "Asistencia" };

export default async function AttendancePage({
  params,
  searchParams,
}: PageProps<"/panel/cuaderno/asistencia/[sectionId]">) {
  const session = await requireRole("docente", "admin", "coordinador", "secretaria");
  const { sectionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sectionId)) notFound();
  const query = await searchParams;
  const raw = Array.isArray(query.fecha) ? query.fecha[0] : query.fecha;
  const today = todayInHonduras();
  const fecha = raw && isIsoDate(raw) && raw <= today ? raw : null;

  const sheet = await academic.attendance(session.accessToken, sectionId, fecha ?? undefined).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const back = session.user.role === "docente" ? "/panel/cuaderno" : "/panel/seguimiento";

  return (
    <div className="space-y-5">
      <div>
        <a href={back} className="text-sm text-slate-500 hover:text-slate-900">
          ← {back === "/panel/cuaderno" ? "Mi cuaderno" : "Seguimiento"}
        </a>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Asistencia · {sheet.section.label}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {sheet.students.length} alumnos
          {!sheet.canEdit && " · Solo lectura: la toma quien da clases en esta sección"}
        </p>
      </div>
      <AttendanceSheet
        owner={session.current.id}
        sheet={sheet}
        requestedDate={fecha}
        renderedAt={Date.now()}
        serverToday={today}
      />
    </div>
  );
}
