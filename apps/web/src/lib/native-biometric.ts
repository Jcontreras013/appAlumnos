"use client";

import { callNative, isNativeApp } from "./native-app";

/*
 * Entrar con la huella en la app de Android (plugin NativeBiometric). Después de entrar con la
 * contraseña, la persona puede activar la huella: el teléfono guarda su usuario y su contraseña
 * cifrados con una llave del teléfono que solo se abre con su huella (o su rostro). Si agrega otra
 * huella en el teléfono, la llave deja de servir y hay que volver a activarla. En el navegador no
 * existe: todo sigue igual.
 */

const PLUGIN = "NativeBiometric";
/** Solo con la huella o el rostro registrados hoy en el teléfono (BIOMETRY_CURRENT_SET). */
const BIOMETRY_CURRENT_SET = 1;
/** El teléfono no tiene guardados datos protegidos para esta dirección. */
const NO_PROTECTED_CREDENTIALS = "21";
/** La persona dijo «Ahora no»: no se le vuelve a ofrecer en este teléfono. */
const DECLINED_KEY = "conecta:huella-no";

const server = () => window.location.host;

export const biometricAvailable = (): boolean =>
  isNativeApp() && window.Capacitor?.isPluginAvailable?.(PLUGIN) === true;

/** ¿El teléfono tiene huella (o rostro) registrada y lista para usar? */
export async function biometricReady(): Promise<boolean> {
  if (!biometricAvailable()) return false;
  try {
    return (await callNative<{ isAvailable: boolean }>(PLUGIN, "isAvailable")).isAvailable;
  } catch {
    return false;
  }
}

/** ¿Ya se activó la huella para entrar a esta dirección de CONECTA? */
export async function biometricSaved(): Promise<boolean> {
  if (!biometricAvailable()) return false;
  try {
    return (await callNative<{ isSaved: boolean }>(PLUGIN, "isCredentialsSaved", { server: server() }))
      .isSaved;
  } catch {
    return false;
  }
}

/** Guarda el usuario y la contraseña protegidos con la huella (el teléfono la pide para guardarlos). */
export async function saveBiometric(login: string, password: string): Promise<void> {
  await callNative(PLUGIN, "setCredentials", {
    username: login,
    password,
    server: server(),
    accessControl: BIOMETRY_CURRENT_SET,
    title: "Activar la huella",
    negativeButtonText: "Cancelar",
  });
  forgetDeclined();
}

export type BiometricRead =
  | { ok: true; login: string; password: string }
  | { ok: false; reason: "cancelada" | "ya-no-sirve" };

/** Pide la huella y devuelve el usuario y la contraseña guardados. */
export async function readBiometric(): Promise<BiometricRead> {
  try {
    const creds = await callNative<{ username: string; password: string }>(PLUGIN, "getSecureCredentials", {
      server: server(),
      title: "Entrar a CONECTA",
      subtitle: "Usa tu huella",
      negativeButtonText: "Usar contraseña",
    });
    return { ok: true, login: creds.username, password: creds.password };
  } catch (err) {
    const code = String((err as { code?: unknown })?.code ?? "");
    // La llave se invalidó (se agregó otra huella al teléfono) o ya no hay datos: hay que reactivarla.
    if (code === NO_PROTECTED_CREDENTIALS) {
      await removeBiometric();
      return { ok: false, reason: "ya-no-sirve" };
    }
    return { ok: false, reason: "cancelada" };
  }
}

export async function removeBiometric(): Promise<void> {
  await callNative(PLUGIN, "deleteCredentials", { server: server() }).catch(() => {});
}

export function declined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDeclined() {
  try {
    localStorage.setItem(DECLINED_KEY, "1");
  } catch {
    // Sin almacenamiento: se volverá a ofrecer la próxima vez.
  }
}

function forgetDeclined() {
  try {
    localStorage.removeItem(DECLINED_KEY);
  } catch {
    // Nada que hacer.
  }
}

/*
 * Entre la pantalla de entrada y el panel: el usuario y la contraseña que se acaban de usar, solo en
 * memoria (nunca en el almacenamiento del navegador), para ofrecer activar la huella al llegar al
 * panel. Se borran al usarlos o al descartarlos.
 */
let pending: { login: string; password: string } | null = null;

export function rememberForBiometric(login: string, password: string) {
  pending = biometricAvailable() ? { login, password } : null;
}

export function pendingBiometric(): { login: string; password: string } | null {
  return pending;
}

export function clearPendingBiometric() {
  pending = null;
}
