import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { ReportCard } from "@/components/report-card";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Boleta" };

export default async function FamilyReportCardPage({ params }: PageProps<"/panel/familia/[id]/boleta">) {
  const session = await requireRole("padre");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const child = await academic.familyChild(session.accessToken, id).catch((err) => {
    if (err instanceof ServiceError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/panel/familia/${id}`} className="text-sm text-slate-500 hover:text-slate-900">
          ← {child.student.name}
        </Link>
        <PrintButton />
      </div>
      <ReportCard child={child} school={session.school} />
    </div>
  );
}
