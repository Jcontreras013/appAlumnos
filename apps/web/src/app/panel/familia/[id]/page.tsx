import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChildOverview } from "@/components/child-overview";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Mi hijo" };

export default async function ChildPage({ params }: PageProps<"/panel/familia/[id]">) {
  const session = await requireRole("padre");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [child, schedule] = await Promise.all([
    academic.familyChild(session.accessToken, id).catch((err) => {
      if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    }),
    academic.childSchedule(session.accessToken, id).catch(() => null),
  ]);
  const { student, period } = child;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/familia" className="text-sm text-slate-500 hover:text-slate-900">
          ← Mis hijos
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{student.name}</h1>
            <p className="text-sm text-slate-500">
              {student.sectionLabel ?? "Sin matrícula vigente"} · Año {student.schoolYearName ?? "—"}
              {period && ` · ${period.name}`}
            </p>
          </div>
          <Link href={`/panel/familia/${student.id}/boleta`} className="btn-secondary">
            Ver boleta
          </Link>
        </div>
      </div>

      <ChildOverview child={child} schedule={schedule} viewer="familia" />
    </div>
  );
}
