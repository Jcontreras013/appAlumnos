import type { Metadata } from "next";
import Link from "next/link";
import { AccountImport } from "@/components/account-import";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";
import { confirmSchoolImportAction, previewSchoolImportAction } from "../actions";

export const metadata: Metadata = { title: "Cargar centros" };

export default async function SchoolImportPage() {
  const session = await requireRole("director_departamental");
  const [department] = await identity.listDepartments(session.accessToken);
  const districtNames = department?.districts.map((d) => d.name).join(", ") ?? "";
  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/region" className="text-sm text-slate-500 hover:text-slate-900">
          ← Tablero de centros
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Cargar centros desde Excel</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Una fila por centro: <strong>nombre</strong>, código (si lo tiene), <strong>distrito</strong> (
          {districtNames}) y el <strong>director o directora</strong> con su identidad (o correo). Al
          confirmar se crean los centros y la cuenta de cada director con una contraseña temporal; después,
          cada dirección carga a su personal y sus alumnos.{" "}
          <a href="/panel/region/importar/plantilla" className="font-semibold text-brand-700 hover:underline">
            Descargar plantilla
          </a>
        </p>
      </div>
      <AccountImport
        kind="centros"
        preview={previewSchoolImportAction}
        confirm={confirmSchoolImportAction}
        title={department ? `Departamental de ${department.name}` : session.current.scopeName}
      />
    </div>
  );
}
