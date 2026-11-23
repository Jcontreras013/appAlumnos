"use client";

import { callNative, isNativeApp, onNative } from "./native-app";

/*
 * Avisos en la app de Android. El visor web de la app no tiene Web Push: la app se registra en
 * Firebase (plugin PushNotifications de Capacitor) y CONECTA guarda el identificador que le da
 * Firebase para mandarle los avisos de los mensajes. Solo dentro de la app.
 */

const PLUGIN = "PushNotifications";
/** El identificador de este teléfono, para quitarlo al desactivar los avisos o al cerrar sesión. */
const TOKEN_KEY = "conecta:avisos-app";

export type NativePermission = "granted" | "denied" | "prompt" | "prompt-with-rationale";

/** ¿Esta es la app de Android con avisos? */
export const nativePushAvailable = (): boolean =>
  isNativeApp() && window.Capacitor?.isPluginAvailable?.(PLUGIN) === true;

export async function nativePermission(): Promise<NativePermission> {
  return (await callNative<{ receive: NativePermission }>(PLUGIN, "checkPermissions")).receive;
}

export async function requestNativePermission(): Promise<NativePermission> {
  return (await callNative<{ receive: NativePermission }>(PLUGIN, "requestPermissions")).receive;
}

/** Registra la app en Firebase y devuelve el identificador del teléfono. */
export async function registerNativePush(): Promise<string> {
  // El canal «Mensajes» (Android 8 o más nuevo): la persona lo puede silenciar aparte en Ajustes.
  await callNative(PLUGIN, "createChannel", {
    id: "mensajes",
    name: "Mensajes",
    description: "Cuando un compañero te escribe",
    importance: 4,
    visibility: 0,
    vibration: true,
  }).catch(() => {});
  return new Promise((resolve, reject) => {
    const handles: unknown[] = [];
    const done = () => {
      clearTimeout(timer);
      for (const h of handles) (h as { remove?: () => void } | undefined)?.remove?.();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("Firebase no respondió"));
    }, 20_000);
    handles.push(
      onNative(PLUGIN, "registration", (data) => {
        done();
        resolve((data as { value: string }).value);
      }),
      onNative(PLUGIN, "registrationError", (data) => {
        done();
        reject(new Error((data as { error?: string }).error ?? "Firebase no registró el teléfono"));
      }),
    );
    callNative(PLUGIN, "register").catch((err) => {
      done();
      reject(err);
    });
  });
}

export async function unregisterNativePush(): Promise<void> {
  await callNative(PLUGIN, "unregister").catch(() => {});
}

export function storedNativeToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeNativeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Sin almacenamiento: al cerrar sesión, Firebase olvida el teléfono igual (unregister).
  }
}

/** Al tocar un aviso: lleva a la conversación (solo direcciones del panel). */
export function onNativeNotificationTap(go: (url: string) => void) {
  onNative(PLUGIN, "pushNotificationActionPerformed", (data) => {
    const url = (data as { notification?: { data?: { url?: unknown } } }).notification?.data?.url;
    if (typeof url === "string" && url.startsWith("/panel/")) go(url);
  });
}
