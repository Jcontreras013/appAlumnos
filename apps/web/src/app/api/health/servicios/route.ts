import { academicUrl, identityUrl } from "@/lib/config";

/**
 * Revisa que el panel llegue a identity y academic por la red interna (Service Connect en AWS).
 * Lo usa «Desplegar en AWS» al terminar: si el panel arrancó antes de que los servicios existieran,
 * no los encuentra por nombre y hay que reiniciarlo. No es el health check del balanceador (ese es
 * /api/health, sin dependencias, para que un servicio lento no saque al panel de circulación).
 */
async function responde(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const [identity, academic] = await Promise.all([responde(identityUrl()), responde(academicUrl())]);
  const ok = identity && academic;
  return Response.json(
    {
      status: ok ? "ok" : "error",
      identity: identity ? "ok" : "sin conexión",
      academic: academic ? "ok" : "sin conexión",
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
