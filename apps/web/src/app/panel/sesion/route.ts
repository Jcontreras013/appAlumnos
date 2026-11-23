/**
 * No hace nada: al pasar por el proxy del panel, la sesión se renueva si estaba por vencer. Lo usan
 * las subidas largas (libros de la biblioteca) antes de reintentar cuando el servicio respondió 401.
 */
export function GET() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
