/**
 * Licencia de una instalación vendida por Gumroad. Se le pregunta a Gumroad si la clave sigue
 * siendo válida; el panel solo se bloquea cuando Gumroad dice claramente que no lo es. Si Gumroad
 * no responde o responde algo inesperado, la instalación sigue funcionando (no se castiga al
 * colegio por una caída ajena).
 */
export type LicenseState =
  /** Esta instalación no pide licencia (la demo o el servidor propio de JC-System). */
  | "no-requerida"
  | "valida"
  | "invalida"
  /** No se pudo preguntar a Gumroad: se deja pasar y se vuelve a intentar. */
  | "sin-verificar";

export interface LicenseStatus {
  state: LicenseState;
  /** Por qué no es válida o no se pudo verificar (en español, para mostrar). */
  reason: string | null;
}

/** Lo que interesa de la respuesta de Gumroad a POST /v2/licenses/verify. */
export interface GumroadVerifyResponse {
  success?: boolean;
  message?: string;
  uses?: number;
  purchase?: {
    product_id?: string;
    email?: string;
    refunded?: boolean;
    disputed?: boolean;
    dispute_won?: boolean;
    chargebacked?: boolean;
    subscription_ended_at?: string | null;
  };
}

/** Decide el estado de la licencia a partir del código HTTP y el cuerpo que devolvió Gumroad. */
export function licenseFromGumroad(httpStatus: number, body: GumroadVerifyResponse | null): LicenseStatus {
  if (httpStatus === 404 || (httpStatus >= 400 && httpStatus < 500 && body?.success === false)) {
    if (httpStatus === 429)
      return { state: "sin-verificar", reason: "Gumroad pidió esperar antes de verificar" };
    // Gumroad responde en inglés: "does not exist", "has been disabled", "access ... has expired".
    const msg = (body?.message ?? "").toLowerCase();
    const reason = msg.includes("disabled")
      ? "La clave de licencia fue desactivada"
      : msg.includes("expired")
        ? "La licencia venció"
        : "La clave de licencia no existe para este producto";
    return { state: "invalida", reason };
  }
  if (httpStatus !== 200 || !body || body.success !== true) {
    return { state: "sin-verificar", reason: `Gumroad respondió ${httpStatus}` };
  }
  const p = body.purchase ?? {};
  if (p.refunded) return { state: "invalida", reason: "La compra de la licencia fue reembolsada" };
  if (p.chargebacked) return { state: "invalida", reason: "La compra de la licencia tuvo un contracargo" };
  if (p.disputed && !p.dispute_won)
    return { state: "invalida", reason: "La compra de la licencia está en disputa" };
  if (p.subscription_ended_at) return { state: "invalida", reason: "La suscripción de la licencia terminó" };
  return { state: "valida", reason: null };
}
