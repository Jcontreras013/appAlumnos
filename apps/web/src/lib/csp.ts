/**
 * Política de contenido: solo código, estilos e imágenes del propio panel; ningún iframe ajeno salvo
 * los videos de YouTube del aula virtual (su versión sin cookies), y ningún formulario que envíe datos
 * a otro sitio. Con `nonce`, solo corren los scripts que Next.js marca
 * en cada respuesta (un valor nuevo por petición); sin él (rutas sin proxy) se permiten en línea.
 */
export function contentSecurityPolicy(nonce?: string, { wasm = false }: { wasm?: boolean } = {}): string {
  // El lector de PDF decodifica algunas imágenes de los libros escaneados con WebAssembly (en su
  // worker, /pdfjs/…): solo ahí se permite compilarlo. Sigue sin permitirse `eval`.
  const wasmSource = wasm ? " 'wasm-unsafe-eval'" : "";
  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : `script-src 'self' 'unsafe-inline'${wasmSource}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // Videos de los mensajes (blob: es la vista previa antes de enviarlos).
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    // Videos de los temas del aula virtual.
    "frame-src https://www.youtube-nocookie.com",
    "frame-ancestors 'none'",
    // El pago con tarjeta: el formulario firmado va a la página segura de PixelPay (y nada más).
    `form-action 'self' ${process.env.PAYMENTS_FORM_ACTION ?? "https://pixelpay.app https://*.pixelpay.app"}`,
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
