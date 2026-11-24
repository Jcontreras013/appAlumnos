import type { Metadata } from "next";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { AddMaterial } from "./add-material";
import { LibraryBrowser } from "./library-browser";

export const metadata: Metadata = { title: "Biblioteca" };

export default async function LibraryPage() {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente", "padre");
  const family = session.user.role === "padre";
  const [items, grades, subjects] = await Promise.all([
    academic.library(session.accessToken),
    family ? [] : academic.listGrades(session.accessToken),
    family ? [] : academic.listSubjects(session.accessToken),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Biblioteca</h1>
        <p className="mt-1 text-sm text-slate-500">
          {family
            ? "Libros de texto, guías y lecturas que el centro comparte para el grado de sus hijos. Los PDF se leen aquí mismo y se pueden guardar en el teléfono para leerlos sin internet."
            : "Libros de texto, guías, lecturas y enlaces por grado y materia. Lo que compartas con las familias lo ven los encargados de los alumnos de ese grado."}
        </p>
      </div>

      {!family && (
        <AddMaterial
          grades={grades.map((g) => ({ id: g.id, name: g.name }))}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}

      <LibraryBrowser items={items} family={family} />
    </div>
  );
}
