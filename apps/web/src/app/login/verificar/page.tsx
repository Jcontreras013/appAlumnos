import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MFA_COOKIE } from "@/lib/session-cookies";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

export default async function VerifyPage() {
  if (!(await cookies()).get(MFA_COOKIE)) redirect("/login");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Verificación en dos pasos</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
          Abre la app de autenticación de tu teléfono (Google Authenticator, Microsoft Authenticator…) y
          escribe el código de «Plataforma Escolar».
        </p>
        <VerifyForm />
        <p className="mt-6 text-sm">
          <Link href="/login" className="text-brand-700 hover:underline">
            ← Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
