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

/** Encabezados del servicio que pasan al navegador (tipo, tamaño, tramo, nombre de descarga…). */
const FILE_HEADERS = [
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
 * Entrega un archivo del servicio (adjuntos de los mensajes, libros de la biblioteca) sin guardarlo en
 * memoria. El servicio revisa que quien lo pide lo pueda ver. Pasa el tramo pedido (`Range`): así se
 * reproducen los videos (también en iPhone) y el lector abre un libro grande sin bajarlo completo.
 */
export async function relayFile(request: Request, serviceUrl: string): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return new Response("Tu sesión venció", { status: 401 });
  const range = request.headers.get("range");
  const res = await fetch(serviceUrl, {
    headers: { authorization: `Bearer ${token}`, ...(range ? { range } : {}) },
    cache: "no-store",
    signal: request.signal,
  });
  if (!res.ok && res.status !== 206) {
    return new Response(res.status === 404 ? "No encontrado" : "No se pudo abrir el archivo", {
      status: res.status,
      headers: res.status === 416 ? { "content-range": res.headers.get("content-range") ?? "" } : {},
    });
  }
  const headers = new Headers();
  for (const name of FILE_HEADERS) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

/**
 * Sube un archivo al servicio tal como llega, sin juntarlo en memoria (los libros pesan). Va fuera de
 * /panel a propósito: el proxy del panel guarda el cuerpo de cada petición y corta a los 10 MB. Si la
 * sesión venció, responde 401: la página la renueva con una consulta al panel y reintenta.
 */
export async function relayUpload(request: Request, serviceUrl: string): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin")
    return Response.json({ error: { message: "Origen no permitido" } }, { status: 403 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return Response.json({ error: { message: "Tu sesión venció" } }, { status: 401 });
  const length = request.headers.get("content-length");
  if (!length || !request.body) {
    return Response.json({ error: { message: "Falta el archivo" } }, { status: 411 });
  }
  const res = await fetch(serviceUrl, {
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
