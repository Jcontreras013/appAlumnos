import type { PushPayload } from "@escolar/shared";
import { importPKCS8, SignJWT } from "jose";
import type { PushResult } from "./push";

/*
 * Avisos a la app de Android por Firebase Cloud Messaging (FCM, API HTTP v1). El visor web de la app
 * no tiene Web Push: la app se registra en Firebase y el servicio le manda el aviso por ahí. Como con
 * Web Push, el aviso dice quién escribió, nunca el texto del mensaje.
 *
 * Credencial: la cuenta de servicio de Firebase (un JSON con project_id, client_email y private_key)
 * en FCM_SERVICE_ACCOUNT. Con ella se pide a Google un permiso de una hora para mandar avisos.
 */

/** Quien entrega los avisos a la app: en producción, Firebase; en las pruebas, un doble. */
export interface NativePushSender {
  /** "gone": Firebase ya no reconoce ese teléfono (se desinstaló la app o se cerró sesión). */
  send(token: string, payload: PushPayload): Promise<PushResult>;
}

export interface FcmServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Cuánto guarda Firebase un aviso si el teléfono está apagado (igual que Web Push). */
const TTL = "43200s";

/** Lee la cuenta de servicio (el JSON que descarga Firebase). */
export function parseServiceAccount(json: string): FcmServiceAccount {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(
      "FCM_SERVICE_ACCOUNT no es un JSON válido (es el archivo de la cuenta de servicio de Firebase)",
    );
  }
  const { project_id, client_email, private_key } = (data ?? {}) as Record<string, unknown>;
  if (
    typeof project_id !== "string" ||
    typeof client_email !== "string" ||
    typeof private_key !== "string" ||
    !private_key.includes("PRIVATE KEY")
  ) {
    throw new Error("FCM_SERVICE_ACCOUNT: faltan project_id, client_email o private_key");
  }
  return { projectId: project_id, clientEmail: client_email, privateKey: private_key };
}

/** El aviso como lo pide Firebase: título, texto, a dónde lleva y cómo se muestra en Android. */
export function fcmMessage(token: string, payload: PushPayload) {
  return {
    token,
    notification: { title: payload.title, body: payload.body },
    data: { url: payload.url, tag: payload.tag },
    android: {
      priority: "HIGH",
      ttl: TTL,
      collapse_key: payload.tag.slice(0, 100),
      notification: {
        tag: payload.tag,
        channel_id: "mensajes",
        icon: "ic_stat_conecta",
        color: "#0B8A6B",
        default_sound: true,
      },
    },
  };
}

interface FcmError {
  error?: {
    message?: string;
    details?: Array<{ errorCode?: string; fieldViolations?: Array<{ field?: string }> }>;
  };
}

/** ¿Firebase dice que ese teléfono ya no existe o que el identificador no sirve? */
function isDeadToken(body: FcmError | null): boolean {
  const details = body?.error?.details ?? [];
  if (details.some((d) => d.errorCode === "UNREGISTERED")) return true;
  const badToken = details.some((d) => d.fieldViolations?.some((v) => v.field === "message.token"));
  return badToken || /registration token/i.test(body?.error?.message ?? "");
}

export function fcmSender(
  account: FcmServiceAccount,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): NativePushSender {
  let access: { token: string; expiresAt: number } | null = null;
  let key: ReturnType<typeof importPKCS8> | null = null;

  async function accessToken(): Promise<string> {
    if (access && access.expiresAt - 60_000 > now()) return access.token;
    key ??= importPKCS8(account.privateKey, "RS256");
    const issuedAt = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await key);
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google no dio permiso para mandar avisos (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Google no dio permiso para mandar avisos");
    access = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return access.token;
  }

  return {
    async send(token, payload) {
      let auth: string;
      try {
        auth = await accessToken();
      } catch {
        return "failed";
      }
      let res: Response;
      try {
        res = await fetchImpl(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
            body: JSON.stringify({ message: fcmMessage(token, payload) }),
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch {
        return "failed";
      }
      if (res.ok) return "sent";
      if (res.status === 404) return "gone";
      if (res.status === 401) access = null;
      if (res.status === 400 && isDeadToken((await res.json().catch(() => null)) as FcmError | null)) {
        return "gone";
      }
      return "failed";
    },
  };
}
