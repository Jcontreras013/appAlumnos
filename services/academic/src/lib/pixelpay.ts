import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/*
 * PixelPay Hosted Payment (https://docs.pixelpay.com, guía «Hosted Payment» y «Firma de seguridad»):
 * CONECTA envía la orden firmada; la familia paga en el checkout de PixelPay (con 3D Secure) y vuelve
 * a `_complete` con `paymentHash`. PixelPay además avisa por `_callback` (POST JSON, hasta 3 intentos).
 *
 * - Firma de la orden: HMAC SHA3-512 de `Key ID|order_id|https://{endpoint}` con la llave secreta.
 * - Verificación del pago: md5(`order_id|Key ID|llave secreta`) === paymentHash / payment_hash.
 */

/** Llaves de prueba que PixelPay publica en su documentación del sandbox. */
export const PIXELPAY_SANDBOX = {
  endpoint: "pixelpay.app",
  keyId: "1234567890",
  secretKey: "@s4ndb0x-abcd-1234-n1l4-p1x3l",
} as const;

export interface GatewayAccount {
  mode: "sandbox" | "produccion";
  endpoint: string;
  keyId: string;
  secretKey: string;
}

export interface HostedOrder {
  orderId: string;
  amountCents: number;
  items: Array<{ title: string; amountCents: number }>;
  firstName: string;
  lastName: string;
  email: string;
  completeUrl: string;
  cancelUrl: string;
  callbackUrl: string;
}

/** El formulario firmado que el navegador de la familia envía (POST) a PixelPay. */
export interface HostedForm {
  action: string;
  fields: Record<string, string>;
}

const amount = (cents: number) => (cents / 100).toFixed(2);

export function clientSignature(
  account: Pick<GatewayAccount, "keyId" | "endpoint" | "secretKey">,
  orderId: string,
) {
  return createHmac("sha3-512", account.secretKey)
    .update([account.keyId, orderId, `https://${account.endpoint}`].join("|"))
    .digest("hex");
}

export function paymentHash(account: Pick<GatewayAccount, "keyId" | "secretKey">, orderId: string) {
  return createHash("md5").update([orderId, account.keyId, account.secretKey].join("|")).digest("hex");
}

/** Compara el hash que llegó con el esperado sin filtrar por tiempo cuánto coincide. */
export function verifyPaymentHash(
  account: Pick<GatewayAccount, "keyId" | "secretKey">,
  orderId: string,
  received: string,
): boolean {
  const expected = Buffer.from(paymentHash(account, orderId));
  const got = Buffer.from(String(received).toLowerCase());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/**
 * Arma el formulario de Hosted Payment. Lo envía el navegador de la familia (no el servidor): PixelPay
 * responde con su checkout y, al terminar, la regresa a `_complete` o `_cancel`. Así CONECTA no
 * depende de que PixelPay acepte llamadas desde un servidor.
 */
export function hostedPaymentForm(account: GatewayAccount, order: HostedOrder): HostedForm {
  const route = account.mode === "sandbox" ? "sandbox" : "other";
  return {
    action: `https://${account.endpoint}/api/v2/transaction/hosted/${route}`,
    fields: {
      _key: account.keyId,
      _client_signature: clientSignature(account, order.orderId),
      _order_id: order.orderId,
      _currency: "HNL",
      _amount: amount(order.amountCents),
      _first_name: order.firstName,
      _last_name: order.lastName,
      _email: order.email,
      _complete: order.completeUrl,
      _cancel: order.cancelUrl,
      _callback: order.callbackUrl,
      _order_content: Buffer.from(
        JSON.stringify(
          order.items.map((i) => ({
            title: i.title.slice(0, 60).padEnd(3, "."),
            price: Number(amount(i.amountCents)),
            qty: 1,
            total: Number(amount(i.amountCents)),
          })),
        ),
      ).toString("base64"),
    },
  };
}

/*
 * La llave secreta de cada centro se guarda cifrada con AES-256-GCM. La llave de cifrado es de la
 * instalación (PAYMENTS_ENCRYPTION_KEY, un secreto de AWS); sin ella no se pueden guardar llaves.
 */
const keyOf = (installationKey: string) => createHash("sha256").update(installationKey).digest();

export function sealSecret(installationKey: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(installationKey), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(
    ".",
  );
}

export function openSecret(installationKey: string, sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Llave guardada con un formato desconocido");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(installationKey), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
