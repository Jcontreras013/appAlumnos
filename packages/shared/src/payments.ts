import { z } from "zod";
import { parseToCents } from "./money";

/*
 * Pagos de las familias al centro: la secretaría o la dirección definen los cobros (matrícula,
 * mensualidades, uniformes…), las familias los ven y los pagan con tarjeta en línea (PixelPay) o en
 * la oficina (efectivo, depósito, transferencia), y cada pago tiene su recibo numerado.
 *
 * Los montos viajan en centavos (enteros) para no perder centavos al sumar; en pantalla, en lempiras.
 */

export const FEE_SCOPES = ["centro", "grado", "seccion", "alumno"] as const;
export type FeeScope = (typeof FEE_SCOPES)[number];
export const FEE_SCOPE_LABELS: Record<FeeScope, string> = {
  centro: "Todo el centro",
  grado: "Un grado",
  seccion: "Una sección",
  alumno: "Un alumno",
};

export const PAYMENT_METHODS = ["efectivo", "deposito", "transferencia", "tarjeta"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  deposito: "Depósito bancario",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta (en línea)",
};
/** Los que registra la oficina a mano (la tarjeta llega sola desde la pasarela). */
export const OFFICE_PAYMENT_METHODS = ["efectivo", "deposito", "transferencia"] as const;

export type ChargeStatus = "pendiente" | "pagado" | "anulado";
export type PaymentStatus = "pendiente" | "confirmado" | "fallido" | "anulado";

/** Lempiras escritos («1,250.50», «L 300») a centavos enteros (ver money.ts). */
export const moneySchema = z
  .union([z.string(), z.number()], { error: "Escribe el monto" })
  .transform((v, ctx) => {
    try {
      const cents = parseToCents(String(v));
      if (cents <= 0 || cents > 100_000_000) {
        ctx.addIssue({ code: "custom", message: "El monto debe ser mayor que cero" });
        return z.NEVER;
      }
      return cents;
    } catch {
      ctx.addIssue({ code: "custom", message: "Monto inválido (máximo dos decimales)" });
      return z.NEVER;
    }
  });

export const feeInputSchema = z
  .object({
    name: z.string().trim().min(3, { error: "Escribe el nombre del cobro" }).max(60),
    amount: moneySchema,
    dueOn: z.iso.date({ error: "Elige la fecha de vencimiento" }),
    scope: z.enum(FEE_SCOPES, { error: "Elige a quiénes se cobra" }),
    /** El grado, la sección o el alumno (vacío para todo el centro). */
    targetId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  })
  .refine((v) => v.scope === "centro" || v.targetId, {
    error: "Elige el grado, la sección o el alumno",
    path: ["targetId"],
  });
export type FeeInput = z.infer<typeof feeInputSchema>;
/** Lo que se envía al servicio: el monto tal como se escribió (el servicio lo pasa a centavos). */
export type FeeRequest = z.input<typeof feeInputSchema>;

export const officePaymentInputSchema = z.object({
  studentId: z.uuid(),
  chargeIds: z.array(z.uuid()).min(1, { error: "Marca al menos un cobro" }).max(50),
  method: z.enum(OFFICE_PAYMENT_METHODS, { error: "Elige cómo pagó" }),
  /** Número de depósito o de transferencia (opcional en efectivo). */
  reference: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(80).optional()),
});
export type OfficePaymentInput = z.infer<typeof officePaymentInputSchema>;

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3, { error: "Escribe por qué se anula" }).max(300),
});

export const onlinePaymentInputSchema = z.object({
  chargeIds: z.array(z.uuid()).min(1, { error: "Marca al menos un cobro" }).max(50),
  /** Correo para el comprobante de la pasarela (PixelPay lo pide). */
  email: z.email({ error: "Escribe un correo válido para el comprobante" }),
  /** Dirección pública de CONECTA a la que vuelve la familia (la pone la web). */
  returnBase: z.url(),
});
export type OnlinePaymentInput = z.infer<typeof onlinePaymentInputSchema>;

export const PAYMENT_MODES = ["sandbox", "produccion"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const paymentSettingsInputSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(PAYMENT_MODES),
  /** Dominio del comercio en PixelPay (por ejemplo, pixelpay.app). */
  endpoint: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .pipe(
      z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, { error: "Escribe el dominio, por ejemplo pixelpay.app" }),
    ),
  keyId: z.string().trim().min(3, { error: "Escribe el Key ID" }).max(64),
  /** Vacío = se conserva la que ya estaba guardada. */
  secretKey: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().min(8).max(200).optional()),
});
export type PaymentSettingsInput = z.infer<typeof paymentSettingsInputSchema>;

export interface FeeDto {
  id: string;
  name: string;
  amountCents: number;
  dueOn: string;
  scope: FeeScope;
  /** «Séptimo grado A», «Primer grado», el nombre del alumno o «Todo el centro». */
  scopeLabel: string;
  createdByName: string;
  createdAt: string;
  cancelled: boolean;
  charges: number;
  paid: number;
  collectedCents: number;
  pendingCents: number;
}

export interface ChargeDto {
  id: string;
  feeId: string;
  name: string;
  amountCents: number;
  dueOn: string;
  status: ChargeStatus;
  overdue: boolean;
  paidAt: string | null;
  paymentId: string | null;
}

export interface PaymentDto {
  id: string;
  studentId: string;
  studentName: string;
  sectionLabel: string | null;
  receiptNumber: number | null;
  amountCents: number;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  /** Quién lo registró en la oficina, o quién pagó en línea. */
  byName: string;
  createdAt: string;
  confirmedAt: string | null;
  voidReason: string | null;
  items: Array<{ name: string; amountCents: number }>;
}

export interface StudentAccountDto {
  studentId: string;
  studentName: string;
  sectionLabel: string | null;
  charges: ChargeDto[];
  payments: PaymentDto[];
  pendingCents: number;
  overdueCents: number;
  /** El centro cobra con tarjeta en línea. */
  onlinePayments: boolean;
}

/** Quién debe: un renglón por alumno con cobros pendientes. */
export interface BalanceRowDto {
  studentId: string;
  studentName: string;
  sectionId: string | null;
  sectionLabel: string | null;
  pendingCents: number;
  overdueCents: number;
  pendingCharges: number;
}

export interface PaymentSettingsDto {
  enabled: boolean;
  mode: PaymentMode;
  endpoint: string;
  keyId: string;
  /** Ya hay una llave secreta guardada (nunca se devuelve). */
  hasSecret: boolean;
  /** La instalación tiene con qué cifrar las llaves (si no, no se pueden guardar). */
  canStoreSecrets: boolean;
}
