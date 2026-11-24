"use client";

/*
 * Cuando CONECTA se abre dentro de la app de Android (apps/mobile), la app agrega a la página
 * `window.Capacitor`. Con él, la página llama a lo que la app hace por su cuenta: guardar archivos en
 * «Descargas» y los avisos del teléfono. En el navegador nada de esto existe y todo sigue igual.
 */

interface NativeBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: <T>(plugin: string, method: string, options?: unknown) => Promise<T>;
  addListener?: (plugin: string, event: string, callback: (data: unknown) => void) => unknown;
}

declare global {
  interface Window {
    Capacitor?: NativeBridge;
  }
}

/** ¿La página está dentro de la app de CONECTA? */
export const isNativeApp = (): boolean =>
  typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true;

/** Llama a un plugin de la app. Solo dentro de la app (ver isNativeApp). */
export function callNative<T>(plugin: string, method: string, options?: unknown): Promise<T> {
  const bridge = window.Capacitor;
  if (!bridge?.nativePromise || !bridge.isPluginAvailable?.(plugin)) {
    return Promise.reject(new Error(`La app no tiene ${plugin}`));
  }
  return bridge.nativePromise<T>(plugin, method, options);
}

/** Escucha un evento de un plugin de la app (por ejemplo, el aviso que se tocó). Devuelve el permiso para dejar de escuchar. */
export function onNative(plugin: string, event: string, callback: (data: unknown) => void): unknown {
  return window.Capacitor?.addListener?.(plugin, event, callback);
}

/** El contenido de un archivo en base64 (sin el prefijo `data:`), para pasarlo a la app. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Descarga un archivo que armó la página (el Word de un documento, la hoja de accesos). En el
 * navegador, con un enlace de descarga; en la app, la app lo guarda en «Descargas» y lo abre.
 */
export async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  if (isNativeApp() && window.Capacitor?.isPluginAvailable?.("ConectaApp")) {
    await callNative("ConectaApp", "saveFile", {
      data: await toBase64(blob),
      fileName,
      mimeType: blob.type || "application/octet-stream",
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
