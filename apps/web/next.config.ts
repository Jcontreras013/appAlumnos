import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Política de contenido: solo código, estilos e imágenes del propio panel; nada de iframes ajenos ni
 * formularios que envíen datos a otro sitio. Next necesita scripts en línea (los datos de cada página
 * viajan en el HTML). En desarrollo no se aplica: la recarga en caliente usa eval.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
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

const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  ...(isProduction
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        // Solo tiene efecto con HTTPS (en AWS con dominio); por HTTP el navegador lo ignora.
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ]
    : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Imagen de Docker mínima para ECS: `node server.js` sin node_modules completos. En Windows sin
  // Docker (scripts/demo-windows.ps1) se apaga con STANDALONE=false: crea enlaces simbólicos que
  // Windows no deja crear sin permisos de administrador, y ahí se usa `next start`.
  output: process.env.STANDALONE === "false" ? undefined : "standalone",
  // En el monorepo, el trazado de archivos parte de la raíz para incluir los paquetes internos.
  outputFileTracingRoot: join(here, "../.."),
  transpilePackages: ["@escolar/shared"],
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Importación de alumnos desde Excel: archivos de hasta 4 MB (más el margen del multipart).
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
