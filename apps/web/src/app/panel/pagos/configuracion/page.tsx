import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { PaymentSettingsForm } from "../forms";

export const metadata: Metadata = { title: "Pago con tarjeta" };

/** La dirección conecta la cuenta de PixelPay del centro (el dinero llega directo al centro). */
export default async function PaymentSettingsPage() {
  const session = await requireRole("admin");
  const settings = await academic.paymentSettings(session.accessToken);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/panel/pagos" className="text-sm text-slate-500 hover:text-slate-900">
          ← Pagos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Pago con tarjeta (PixelPay)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Las familias pagan en la página segura de PixelPay, con cualquier tarjeta, y el dinero llega a la
          cuenta del centro. CONECTA no ve los datos de las tarjetas.
        </p>
      </div>
      <section className="card space-y-3 p-5 text-sm text-slate-600">
        <h2 className="font-semibold text-slate-900">Dónde están los datos</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Entra a tu cuenta de PixelPay → Preferencias → Opciones del API.</li>
          <li>
            Copia el Key ID y la Secret Key. El dominio es el que aparece en la barra del navegador (por
            ejemplo, pixelpay.app).
          </li>
          <li>
            Para probar sin cobros reales, deja el modo «Prueba» con el Key ID de prueba de PixelPay
            (1234567890): no hace falta llave.
          </li>
        </ol>
      </section>
      {!settings.canStoreSecrets && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Esta instalación todavía no tiene la llave para guardar contraseñas de la pasarela: por ahora solo
          funciona el modo de prueba.
        </p>
      )}
      <section className="card p-5">
        <PaymentSettingsForm settings={settings} />
      </section>
    </div>
  );
}
