import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Pago" };

/**
 * Regreso desde PixelPay. Con `paymentHash` (pago exitoso) se confirma el pago y se muestra el recibo;
 * con `cancelado` se avisa que no se cobró. Si el aviso de PixelPay llegó antes, ya estaba confirmado.
 */
export default async function PaymentReturnPage({ searchParams }: PageProps<"/panel/pagos/volver">) {
  const session = await requireRole("padre", "estudiante", "admin", "secretaria");
  // El alumno que responde por sí mismo vuelve a «Mis pagos»; la familia, a «Pagos».
  const home = session.user.role === "estudiante" ? "/panel/pagos/mis-pagos" : "/panel/pagos/familia";
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const orderId = one(q.orden);
  const paymentHash = one(q.paymentHash);
  const cancelled = one(q.cancelado) === "1";
  if (!orderId) redirect("/panel");
  const result = await academic
    .completeOnline(session.accessToken, { orderId, paymentHash: paymentHash || undefined, cancelled })
    .catch(() => null);
  if (result?.status === "confirmado") redirect(`/panel/pagos/recibo/${result.paymentId}?nuevo=1`);
  if (result?.status === "cancelado") redirect(`${home}?cancelado=1`);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">No pudimos confirmar el pago todavía</h1>
      <p className="text-sm text-slate-600">
        Si PixelPay te mostró el pago como aprobado, se confirmará solo en unos minutos (te llegará también el
        comprobante al correo). Si no, no se hizo ningún cobro.
      </p>
      <Link href={home} className="btn-primary">
        Volver a Pagos
      </Link>
    </div>
  );
}
