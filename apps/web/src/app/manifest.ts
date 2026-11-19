import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/**
 * Permite agregar el panel a la pantalla de inicio del teléfono. En iPhone es requisito para recibir
 * avisos de mensajes: Safari solo los entrega a las páginas abiertas desde ese ícono.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/panel",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0b8a6b",
    lang: "es-HN",
  };
}
