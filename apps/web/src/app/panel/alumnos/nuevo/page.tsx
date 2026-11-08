import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { NewStudentForm } from "./new-student-form";

export const metadata: Metadata = { title: "Nuevo alumno" };

export default async function NewStudentPage() {
  const session = await requireRole("admin", "secretaria");
  const sections = await academic.listSections(session.accessToken);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/panel/alumnos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Alumnos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Nuevo alumno</h1>
        <p className="mt-1 text-sm text-slate-500">
          Datos del alumno, su responsable principal y, si quieres, la sección donde queda matriculado.
        </p>
      </div>
      <NewStudentForm
        sections={sections.map((s) => {
          const full = s.capacity !== null && s.enrolledCount >= s.capacity;
          return {
            value: s.id,
            label: `${s.label} (${s.enrolledCount}${s.capacity !== null ? `/${s.capacity}` : ""})${full ? " — llena" : ""}`,
          };
        })}
      />
    </div>
  );
}
