import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { NewStudentForm } from "./new-student-form";

export const metadata: Metadata = { title: "Nuevo alumno" };

export default async function NewStudentPage() {
  const session = await requireRole("admin", "secretaria", "docente");
  // El maestro (si la dirección activó la matrícula por maestros) registra solo en sus secciones.
  const teacher = session.user.role === "docente";
  const settings = teacher ? await academic.enrollmentSettings(session.accessToken) : null;
  if (teacher && !settings?.teachersEnroll) notFound();
  const sections = (await academic.listSections(session.accessToken)).filter(
    (s) => !teacher || settings?.mySectionIds.includes(s.id),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/panel/alumnos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Alumnos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Nuevo alumno</h1>
        <p className="mt-1 text-sm text-slate-500">
          {teacher
            ? "Datos del alumno, su responsable principal y la sección donde queda matriculado."
            : "Datos del alumno, su responsable principal y, si quieres, la sección donde queda matriculado."}
        </p>
      </div>
      <NewStudentForm
        sectionRequired={teacher}
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
