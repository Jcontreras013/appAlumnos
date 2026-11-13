/**
 * Política de contenido: solo código, estilos e imágenes del propio panel; nada de iframes ajenos ni
 * formularios que envíen datos a otro sitio. Con `nonce`, solo corren los scripts que Next.js marca
 * en cada respuesta (un valor nuevo por petición); sin él (rutas sin proxy) se permiten en línea.
 */
export function contentSecurityPolicy(nonce?: string): string {
  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
