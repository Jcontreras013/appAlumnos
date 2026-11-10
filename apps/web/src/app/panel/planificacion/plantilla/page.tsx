import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Plantilla de planificación" };

export default async function TemplatePage() {
  const session = await requireRole("admin", "coordinador");
  const template = await academic.planTemplate(session.accessToken);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/planificacion" className="text-sm text-slate-500 hover:text-slate-900">
          ← Planificación semanal
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Plantilla de planificación</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Los campos que llena cada maestro en su planificación semanal.{" "}
          {template.isDefault
            ? "Ahora se usa la plantilla basada en el Currículo Nacional Básico; puedes ajustarla a tu centro."
            : "Esta es la plantilla de tu centro."}{" "}
          Los cambios se aplican a las planificaciones nuevas; las que ya existen conservan sus campos.
        </p>
      </div>
      <TemplateForm template={{ fields: template.fields, deadlineDaysBefore: template.deadlineDaysBefore }} />
    </div>
  );
}
