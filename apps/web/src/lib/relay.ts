import "server-only";
import { cookies } from "next/headers";
import { ServiceError } from "./api";
import { ACCESS_COOKIE } from "./session-cookies";

/**
 * Para las rutas que el panel consulta cada pocos segundos (mensajes nuevos, no leídos): reenvía la
 * consulta al servicio con la sesión de la cookie y devuelve JSON. El proxy ya renovó la sesión si
 * hacía falta; si venció del todo, responde 401 y la página se recarga para volver a entrar.
 */
export async function relayJson<T>(request: Request, load: (token: string) => Promise<T>): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ error: "origen no permitido" }, { status: 403 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return Response.json({ error: "sesion" }, { status: 401 });
  try {
    return Response.json(await load(token), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ServiceError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
