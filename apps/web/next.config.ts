import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/csp";

const here = dirname(fileURLToPath(import.meta.url));

const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  ...(isProduction
    ? [
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
    return [
      { source: "/:path*", headers: securityHeaders },
      // El panel y el ingreso reciben su política (con nonce) del proxy; el resto, una fija.
      ...(isProduction
        ? [
            {
              source: "/((?!panel|login).*)",
              headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
