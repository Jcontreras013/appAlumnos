import type { Metadata } from "next";
import Link from "next/link";
import { AccountImport } from "@/components/account-import";
import { requireRole } from "@/lib/dal";
import { confirmStaffImportAction, previewStaffImportAction } from "../actions";

export const metadata: Metadata = { title: "Cargar personal" };

export default async function StaffImportPage() {
  const session = await requireRole("admin");
  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/usuarios" className="text-sm text-slate-500 hover:text-slate-900">
          ← Personal y usuarios
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Cargar personal desde Excel</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Una fila por persona con su <strong>nombre</strong>, su <strong>identidad</strong> (con eso
          entrará), su correo si lo tiene y su <strong>cargo</strong> (docente, coordinador o secretaria;
          vacío = docente). Primero se revisa todo; al confirmar se crean las cuentas con una contraseña
          temporal para entregar en papel.{" "}
          <a
            href="/panel/usuarios/importar/plantilla"
            className="font-semibold text-brand-700 hover:underline"
          >
            Descargar plantilla
          </a>
        </p>
      </div>
      <AccountImport
        kind="personal"
        preview={previewStaffImportAction}
        confirm={confirmStaffImportAction}
        title={session.school?.name ?? "Plataforma Escolar"}
      />
    </div>
  );
}
