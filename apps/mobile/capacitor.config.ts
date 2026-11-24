import type { CapacitorConfig } from "@capacitor/cli";

/*
 * App de CONECTA para Android. No trae una copia de la plataforma: abre la plataforma publicada
 * (CONECTA_URL, la misma dirección que se usa en el navegador), así cada mejora llega a la app sin
 * publicar una versión nueva en Play Store. Lo que agrega la app: ícono propio, descargas de archivos,
 * cámara al adjuntar, avisos del teléfono (Firebase), el botón «atrás» de Android y una pantalla
 * propia cuando no hay internet.
 *
 * Variables al preparar la app (`pnpm --filter @escolar/mobile sync`):
 *   CONECTA_URL     Dirección pública, con https (por ejemplo https://conecta.micentro.hn).
 *                   Sin ella, la app de prueba abre http://10.0.2.2:3000: el CONECTA local visto
 *                   desde el emulador de Android.
 *   CONECTA_APP_ID  Identificador en Play Store. No se puede cambiar después de la primera
 *                   publicación (ver apps/mobile/README.md).
 */
// En GitHub Actions, una variable sin definir llega vacía: cuenta como no puesta.
const base = (process.env.CONECTA_URL?.trim() || "http://10.0.2.2:3000").replace(/\/+$/, "");
const url = new URL(base);
if (url.protocol !== "https:" && url.hostname !== "10.0.2.2" && url.hostname !== "localhost") {
  throw new Error(`CONECTA_URL tiene que empezar con https:// (vino ${base})`);
}

const config: CapacitorConfig = {
  appId: process.env.CONECTA_APP_ID?.trim() || "com.jcsystem.conecta",
  appName: "CONECTA",
  // Solo la pantalla de «sin conexión»: la plataforma se abre desde CONECTA_URL.
  webDir: "www",
  server: {
    // Entra directo al panel: sin internet, el service worker de la plataforma abre el cuaderno y
    // los libros guardados desde ahí.
    url: `${base}/panel`,
    cleartext: url.protocol === "http:",
    errorPath: "sin-conexion.html",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0b8a6b",
      showSpinner: false,
      androidScaleType: "CENTER_INSIDE",
    },
    // Avisos de los mensajes por Firebase. Con la app abierta también se muestran.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    StatusBar: {
      backgroundColor: "#086f57",
      style: "DARK",
      overlaysWebView: false,
    },
  },
};

export default config;
