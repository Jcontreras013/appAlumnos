import { formatLempiras } from "@escolar/shared";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { academic } from "@/lib/academic";
import { APP_MARK, APP_NAME } from "@/lib/brand";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/session-cookies";

export const metadata: Metadata = { title: "Pago con tarjeta" };

/**
 * Regreso desde PixelPay (`_complete` y `_cancel`). Es pública a propósito: en la app de Android el pago
 * se hace en el navegador del teléfono, donde la persona no tiene la sesión de CONECTA. El pago se
 * confirma con el `paymentHash` que agrega PixelPay (solo se arma con la llave secreta del centro).
 * Quien sí tiene sesión en este navegador pasa directo a su recibo.
 */
export default async function PaymentBackPage({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { schoolId } = await params;
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const orderId = one(q.orden);
  const paymentHash = one(q.paymentHash);
  const cancelled = one(q.cancelado) === "1";
  if (!/^[0-9a-f-]{36}$/i.test(schoolId) || !orderId) redirect("/");

  const result = await academic
    .returnOnline(schoolId, { orderId, paymentHash: paymentHash || undefined, cancelled })
    .catch(() => null);
  const jar = await cookies();
  const signedIn = Boolean(jar.get(ACCESS_COOKIE) || jar.get(REFRESH_COOKIE));
  if (result?.status === "confirmado" && signedIn) {
    redirect(`/panel/pagos/recibo/${result.paymentId}?nuevo=1`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="card space-y-4 p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-600 text-lg font-semibold text-white">
          {APP_MARK}
        </span>
        {result?.status === "confirmado" ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">¡Pago recibido!</h1>
            <p className="text-sm text-slate-600">
              Se pagaron <strong>{formatLempiras(result.amountCents)}</strong>
              {result.receiptNumber ? ` · Recibo N.º ${result.receiptNumber}` : ""}. PixelPay también te envió
              el comprobante por correo.
            </p>
            {result.duplicate && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Ese cobro ya estaba pagado: el centro revisará la devolución de este pago.
              </p>
            )}
          </>
        ) : result?.status === "cancelado" ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">No se hizo el cobro</h1>
            <p className="text-sm text-slate-600">
              Cancelaste el pago. Puedes intentarlo de nuevo cuando quieras.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-900">No pudimos confirmar el pago todavía</h1>
            <p className="text-sm text-slate-600">
              Si PixelPay te mostró el pago como aprobado, se confirmará solo en unos minutos (te llegará el
              comprobante al correo). Si no, no se hizo ningún cobro.
            </p>
          </>
        )}
        <p className="text-sm text-slate-500">
          Si pagaste desde la app de {APP_NAME}, ya puedes cerrar esta página y volver a la app: tu pago
          aparece en «Pagos».
        </p>
        <Link href="/panel" className="btn-primary inline-flex justify-center">
          Ir a {APP_NAME}
        </Link>
      </div>
    </main>
  );
}
