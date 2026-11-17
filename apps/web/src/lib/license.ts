import "server-only";
import { type GumroadVerifyResponse, type LicenseStatus, licenseFromGumroad } from "@escolar/shared";
import { GUMROAD_PRODUCT_ID } from "./brand";

const VERIFY_URL = process.env.GUMROAD_VERIFY_URL || "https://api.gumroad.com/v2/licenses/verify";
/** Cada cuánto se vuelve a preguntar: válida, 12 horas; inválida, 10 minutos; sin respuesta, 15 minutos. */
const TTL = { valida: 12 * 3600_000, invalida: 10 * 60_000, "sin-verificar": 15 * 60_000 } as const;

let cache: { status: LicenseStatus; until: number } | null = null;
let pending: Promise<LicenseStatus> | null = null;

/** Producto de Gumroad de esta instalación (la variable de entorno solo puede cambiarlo, no quitarlo). */
function productId(): string {
  return (process.env.GUMROAD_PRODUCT_ID || GUMROAD_PRODUCT_ID).trim();
}

async function verify(product: string, key: string): Promise<LicenseStatus> {
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // increment_uses_count=false: revisar no cuenta como una instalación más.
      body: new URLSearchParams({ product_id: product, license_key: key, increment_uses_count: "false" }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => null)) as GumroadVerifyResponse | null;
    return licenseFromGumroad(res.status, body);
  } catch {
    return { state: "sin-verificar", reason: "No se pudo contactar a Gumroad" };
  }
}

/**
 * Estado de la licencia de esta instalación. Sin producto configurado no se pide licencia (la demo y
 * el servidor propio). Con producto, la clave va en CONECTA_LICENSE_KEY.
 */
export async function currentLicense(): Promise<LicenseStatus> {
  const product = productId();
  if (!product) return { state: "no-requerida", reason: null };
  const key = process.env.CONECTA_LICENSE_KEY?.trim();
  if (!key)
    return { state: "invalida", reason: "Esta instalación no tiene clave de licencia (CONECTA_LICENSE_KEY)" };
  if (cache && cache.until > Date.now()) return cache.status;
  pending ??= verify(product, key)
    .then((status) => {
      if (status.state === "sin-verificar") console.warn(`[licencia] ${status.reason}`);
      cache = { status, until: Date.now() + TTL[status.state as keyof typeof TTL] };
      return status;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
