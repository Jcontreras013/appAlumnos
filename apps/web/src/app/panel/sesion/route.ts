/**
 * No hace nada: al pasar por el proxy del panel, la sesión se renueva si estaba por vencer. Lo usan
 * las subidas largas (libros de la biblioteca) antes de reintentar cuando el servicio respondió 401.
 */
export function GET() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/**
 * «Sigo aquí»: mientras la persona usa una página sin cambiar de página (escribe una planificación
 * larga, lee un libro), la página avisa cada pocos minutos su última actividad y el proxy la guarda.
 */
export function POST() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
