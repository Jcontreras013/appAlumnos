import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";

/**
 * Aviso de pago de PixelPay (`_callback`): llega sin sesión y se pasa tal cual al servicio académico,
 * que lo valida con el `payment_hash` (solo se arma con la llave secreta del centro). PixelPay
 * reintenta si no recibe 200.
 */
export async function POST(request: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return Response.json({ ok: false }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ ok: false }, { status: 400 });
  try {
    await academic.pixelpayCallback(schoolId, body);
    return Response.json({ ok: true });
  } catch (err) {
    const status = err instanceof ServiceError ? err.status : 500;
    return Response.json({ ok: false }, { status: Math.min(status, 500) });
  }
}
