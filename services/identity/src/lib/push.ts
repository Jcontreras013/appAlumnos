import type { PushPayload } from "@escolar/shared";
import webpush from "web-push";

/*
 * Avisos al celular con Web Push: el navegador del teléfono se suscribe con la llave pública de la
 * instalación y el servicio le manda el aviso a través del servicio de avisos del navegador (Google,
 * Apple, Mozilla). El aviso va cifrado para ese teléfono y nunca lleva el texto del mensaje.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = "sent" | "gone" | "failed";

/** Quien entrega los avisos: en producción, Web Push; en las pruebas, un doble. */
export interface PushSender {
  publicKey: string;
  /** "gone": el teléfono ya no acepta avisos de esa suscripción (se borra). */
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** Contacto de quien opera la plataforma ("mailto:…" o "https://…"); lo piden Apple y Google. */
  subject: string;
}

/** Cuánto guarda el servicio de avisos un aviso si el teléfono está apagado. */
const TTL_SECONDS = 12 * 60 * 60;

export function webPushSender(vapid: VapidConfig, fetchImpl: typeof fetch = fetch): PushSender {
  return {
    publicKey: vapid.publicKey,
    async send(target, payload) {
      const request = webpush.generateRequestDetails(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails: vapid, TTL: TTL_SECONDS, urgency: "normal" },
      );
      let response: Response;
      try {
        response = await fetchImpl(request.endpoint, {
          method: request.method,
          headers: request.headers as Record<string, string>,
          body: request.body ? new Uint8Array(request.body) : null,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return "failed";
      }
      if (response.status === 404 || response.status === 410) return "gone";
      return response.ok ? "sent" : "failed";
    },
  };
}

/** Llaves nuevas para una instalación (ver scripts/generate-push-keys.ts). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
