import { cookies } from "next/headers";
import { z } from "zod";
import { identityUrl } from "@/lib/config";
import { ACCESS_COOKIE } from "@/lib/session-cookies";

/** Encabezados del servicio que pasan al navegador (tipo, tamaño, tramo, nombre de descarga…). */
const PASS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "cache-control",
  "x-content-type-options",
  "content-security-policy",
];

/**
 * Entrega una foto, un video o un documento de los mensajes. El servicio revisa que quien lo pide esté
 * en la conversación. Pasa el tramo pedido (`Range`): así se reproducen los videos, también en iPhone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ adjuntoId: string }> }) {
  const { adjuntoId } = await params;
  if (!z.uuid().safeParse(adjuntoId).success) return new Response("No encontrado", { status: 404 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response("Tu sesión venció", { status: 401 });
  const range = request.headers.get("range");
  const res = await fetch(`${identityUrl()}/messages/attachments/${adjuntoId}`, {
    headers: { authorization: `Bearer ${token}`, ...(range ? { range } : {}) },
    cache: "no-store",
    signal: request.signal,
  });
  if (!res.ok && res.status !== 206) {
    return new Response(res.status === 404 ? "No encontrado" : "No se pudo abrir el archivo", {
      status: res.status,
    });
  }
  const headers = new Headers();
  for (const name of PASS) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}
