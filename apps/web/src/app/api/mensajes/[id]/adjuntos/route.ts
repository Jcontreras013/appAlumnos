import { cookies } from "next/headers";
import { z } from "zod";
import { identityUrl } from "@/lib/config";
import { ACCESS_COOKIE } from "@/lib/session-cookies";

/**
 * Sube una foto, un video o un documento a una conversación. Está fuera de /panel a propósito: el
 * proxy del panel guarda en memoria el cuerpo de cada petición (y corta a los 10 MB), y un video pesa
 * más. Aquí el archivo pasa directo al servicio de identidad, sin guardarse, que lo revisa y lo guarda.
 * Si la sesión venció, responde 401: el chat la renueva con una consulta al panel y reintenta.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin")
    return Response.json({ error: { message: "Origen no permitido" } }, { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: { message: "Conversación inválida" } }, { status: 400 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return Response.json({ error: { message: "Tu sesión venció" } }, { status: 401 });
  const length = request.headers.get("content-length");
  if (!length || !request.body) {
    return Response.json({ error: { message: "Falta el archivo" } }, { status: 411 });
  }
  const res = await fetch(`${identityUrl()}/messages/conversations/${id}/attachments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": request.headers.get("content-type") ?? "application/octet-stream",
      "content-length": length,
      "x-file-name": request.headers.get("x-file-name") ?? "",
    },
    body: request.body,
    // El archivo pasa en partes, sin juntarlo entero en memoria.
    duplex: "half",
    cache: "no-store",
  } as RequestInit & { duplex: "half" });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
