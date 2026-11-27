"use client";

import { useEffect, useState } from "react";
import {
  removeNativePushAction,
  removePushAction,
  saveNativePushAction,
  savePushAction,
} from "@/app/panel/mensajes/actions";
import {
  nativePermission,
  nativePushAvailable,
  registerNativePush,
  requestNativePermission,
  storedNativeToken,
  storeNativeToken,
  unregisterNativePush,
} from "@/lib/native-push";

type State =
  | "cargando"
  | "oculto"
  | "no-disponible"
  | "iphone"
  | "bloqueados"
  | "apagados"
  | "activando"
  | "encendidos";

/** La llave pública llega en base64url; el navegador la pide en bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** En iPhone los avisos solo funcionan si CONECTA se abrió desde el ícono de la pantalla de inicio. */
function iphoneOutsideApp(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  // El panel registra el service worker al cargar; se le da un momento.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
  ]);
}

/** Activa los avisos de la app de Android: Firebase da el identificador y CONECTA lo guarda. */
async function enableNative(): Promise<{ ok: boolean; error?: string }> {
  const token = await registerNativePush();
  const result = await saveNativePushAction(token);
  if (result.ok) storeNativeToken(token);
  return result;
}

/** Olvida los avisos de este teléfono (al desactivarlos o al cerrar sesión). Nunca falla. */
export async function forgetPushOnThisDevice(): Promise<void> {
  try {
    if (nativePushAvailable()) {
      const token = storedNativeToken();
      // Sin identificador guardado, este teléfono nunca activó los avisos: no hay nada que olvidar. Y no
      // se debe tocar Firebase: en una app armada sin Firebase (sin google-services.json), «unregister»
      // cierra la app de golpe y la sesión queda abierta.
      if (!token) return;
      await removeNativePushAction(token).catch(() => {});
      storeNativeToken(null);
      // Firebase olvida el identificador: si en este teléfono entra otra persona, recibe uno nuevo.
      await unregisterNativePush();
      return;
    }
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await Promise.allSettled([removePushAction(sub.endpoint), sub.unsubscribe()]);
  } catch {
    // Cerrar sesión nunca debe fallar por esto.
  }
}

/** Tarjeta para activar los avisos de mensajes en este teléfono o computadora. */
export function PushToggle({
  publicKey,
  nativeAvailable,
}: {
  publicKey: string | null;
  nativeAvailable: boolean;
}) {
  const [state, setState] = useState<State>("cargando");
  const [error, setError] = useState<string | null>(null);
  const native = nativePushAvailable();

  useEffect(() => {
    if (!native) return;
    // Dentro de la app de Android: avisos por Firebase.
    if (!nativeAvailable) return setState("oculto");
    let alive = true;
    (async () => {
      const permission = await nativePermission();
      if (!alive) return;
      if (permission === "denied") return setState("bloqueados");
      if (permission === "granted" && storedNativeToken()) {
        // Firebase puede cambiar el identificador: se vuelve a guardar el de hoy.
        const result = await enableNative().catch(() => ({ ok: false }));
        if (alive) setState(result.ok ? "encendidos" : "apagados");
        return;
      }
      setState("apagados");
    })().catch(() => alive && setState("apagados"));
    return () => {
      alive = false;
    };
  }, [native, nativeAvailable]);

  useEffect(() => {
    if (native || !publicKey) return;
    let alive = true;
    (async () => {
      if (!supported()) return setState(iphoneOutsideApp() ? "iphone" : "no-disponible");
      if (Notification.permission === "denied") return setState("bloqueados");
      const reg = await registration();
      if (!alive) return;
      if (!reg) return setState("no-disponible");
      const sub = await reg.pushManager.getSubscription();
      if (!alive) return;
      if (sub && Notification.permission === "granted") {
        // Si en este teléfono entró otra persona, los avisos pasan a quien tiene la sesión abierta.
        void savePushAction(sub.toJSON());
        setState("encendidos");
      } else {
        setState("apagados");
      }
    })().catch(() => alive && setState("no-disponible"));
    return () => {
      alive = false;
    };
  }, [native, publicKey]);

  if ((!native && !publicKey) || state === "cargando" || state === "oculto") return null;

  async function enable() {
    setError(null);
    if (native) {
      setState("activando");
      try {
        const permission = await requestNativePermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "bloqueados" : "apagados");
          return;
        }
        const result = await enableNative();
        if (!result.ok) setError(result.error ?? "No se pudieron activar los avisos");
        setState(result.ok ? "encendidos" : "apagados");
      } catch {
        setError("La app no pudo activar los avisos. Revisa la conexión e intenta de nuevo.");
        setState("apagados");
      }
      return;
    }
    if (!publicKey) return;
    setState("activando");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "bloqueados" : "apagados");
        return;
      }
      const reg = await registration();
      if (!reg) {
        setState("no-disponible");
        return;
      }
      // Una suscripción vieja (de otras llaves) no sirve: se cambia por una nueva.
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const result = await savePushAction(sub.toJSON());
      if (!result.ok) {
        await sub.unsubscribe();
        setError(result.error ?? "No se pudieron activar los avisos");
        setState("apagados");
        return;
      }
      setState("encendidos");
    } catch {
      setError("Este navegador no permitió activar los avisos. Intenta de nuevo o usa Chrome.");
      setState("apagados");
    }
  }

  async function disable() {
    await forgetPushOnThisDevice();
    setState("apagados");
  }

  const hours =
    "de 6:00 a. m. a 7:00 p. m., de lunes a viernes (y también sábado y domingo si tu centro tiene jornada de fin de semana)";
  return (
    <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-900">Avisos en este teléfono</p>
        {state === "encendidos" ? (
          <p className="mt-0.5 text-slate-500">
            Activados. Te avisamos cuando te escriban, {hours}. Lo que llegue fuera de ese horario te lo
            avisamos al empezar la jornada.
          </p>
        ) : state === "iphone" ? (
          <p className="mt-0.5 text-slate-500">
            En iPhone, primero toca <strong>Compartir</strong> y luego <strong>Agregar a inicio</strong>. Abre
            CONECTA desde ese ícono y activa los avisos ahí.
          </p>
        ) : state === "bloqueados" && native ? (
          <p className="mt-0.5 text-slate-500">
            Los avisos de CONECTA están apagados en el teléfono. Actívalos en Ajustes → Apps → CONECTA →
            Notificaciones y vuelve a esta página.
          </p>
        ) : state === "bloqueados" ? (
          <p className="mt-0.5 text-slate-500">
            Los avisos están bloqueados para este sitio. Actívalos en la configuración del navegador (el
            candado junto a la dirección → Notificaciones → Permitir) y vuelve a esta página.
          </p>
        ) : state === "no-disponible" ? (
          <p className="mt-0.5 text-slate-500">
            Este navegador no permite avisos. En Android usa Chrome; en iPhone, agrega CONECTA a la pantalla
            de inicio.
          </p>
        ) : (
          <p className="mt-0.5 text-slate-500">
            Que el teléfono te avise cuando un compañero te escriba, {hours}. El aviso no muestra el texto del
            mensaje.
          </p>
        )}
        {error && (
          <p className="mt-1 text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>
      {state === "encendidos" ? (
        <button type="button" className="btn-secondary shrink-0" onClick={() => void disable()}>
          Desactivar
        </button>
      ) : state === "apagados" || state === "activando" ? (
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={state === "activando"}
          onClick={() => void enable()}
        >
          {state === "activando" ? "Activando…" : "Activar avisos"}
        </button>
      ) : null}
    </div>
  );
}
