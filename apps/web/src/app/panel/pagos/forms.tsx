"use client";

import {
  type ChargeDto,
  formatDay,
  formatLempiras,
  OFFICE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentSettingsDto,
} from "@escolar/shared";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Field, FormAlert, SelectField, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import {
  type CheckoutState,
  createFeeAction,
  payOnlineAction,
  recordPaymentAction,
  savePaymentSettingsAction,
  voidPaymentAction,
} from "./actions";

type Option = { value: string; label: string };

/** Nuevo cobro: para todo el centro, un grado o una sección (o un alumno, desde su estado de cuenta). */
export function FeeForm({
  grades,
  sections,
  studentId,
}: {
  grades: Option[];
  sections: Option[];
  studentId?: string;
}) {
  const [state, action] = useActionState(createFeeAction, initialFormState);
  const [scope, setScope] = useState(studentId ? "alumno" : (state.values?.scope ?? "centro"));
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <Field name="name" label="Concepto" placeholder="Mensualidad de febrero" required state={state} />
      <div className="grid grid-cols-2 gap-3">
        <Field
          name="amount"
          label="Monto (L)"
          inputMode="decimal"
          placeholder="1,500.00"
          required
          state={state}
        />
        <Field name="dueOn" label="Vence" type="date" required state={state} />
      </div>
      {studentId ? (
        <>
          <input type="hidden" name="scope" value="alumno" />
          <input type="hidden" name="targetId" value={studentId} />
        </>
      ) : (
        <>
          <div>
            <label htmlFor="campo-scope" className="label">
              ¿A quiénes?
            </label>
            <select
              id="campo-scope"
              name="scope"
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="centro">Todo el centro</option>
              <option value="grado">Un grado</option>
              <option value="seccion">Una sección</option>
            </select>
          </div>
          {scope === "grado" && (
            <SelectField name="gradeId" label="Grado" options={grades} placeholder="Elige…" state={state} />
          )}
          {scope === "seccion" && (
            <SelectField
              name="sectionId"
              label="Sección"
              options={sections}
              placeholder="Elige…"
              state={state}
            />
          )}
          {state.fields?.targetId && <p className="text-xs text-red-600">{state.fields.targetId}</p>}
        </>
      )}
      <p className="text-xs text-slate-500">Se crea un cobro para cada alumno matriculado a quien aplique.</p>
      <SubmitButton pendingText="Creando…">Crear cobro</SubmitButton>
    </form>
  );
}

/** Lista de cobros pendientes con casillas (para pagar en la oficina o con tarjeta). */
function PendingCharges({ charges }: { charges: ChargeDto[] }) {
  const [picked, setPicked] = useState<string[]>(charges.filter((c) => c.overdue).map((c) => c.id));
  const total = charges.filter((c) => picked.includes(c.id)).reduce((sum, c) => sum + c.amountCents, 0);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {charges.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="chargeIds"
                value={c.id}
                checked={picked.includes(c.id)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((id) => id !== c.id)))
                }
                className="size-4 accent-brand-600"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-900">{c.name}</span>
                <span className={`text-xs ${c.overdue ? "text-amber-700" : "text-slate-500"}`}>
                  {c.overdue ? "Vencido el " : "Vence el "}
                  {formatDay(c.dueOn)}
                </span>
              </span>
              <span className="tabular-nums font-medium">{formatLempiras(c.amountCents)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-right text-sm">
        Total: <strong className="tabular-nums">{formatLempiras(total)}</strong>
      </p>
    </div>
  );
}

/** La oficina registra un pago en efectivo, depósito o transferencia. */
export function RecordPaymentForm({ studentId, charges }: { studentId: string; charges: ChargeDto[] }) {
  const [state, action] = useActionState(recordPaymentAction, initialFormState);
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="studentId" value={studentId} />
      <PendingCharges charges={charges} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="method"
          label="Cómo pagó"
          defaultValue="efectivo"
          options={OFFICE_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
          state={state}
        />
        <Field name="reference" label="Número de depósito o referencia (opcional)" state={state} />
      </div>
      <SubmitButton pendingText="Registrando…">Registrar pago y ver recibo</SubmitButton>
    </form>
  );
}

export function VoidPaymentForm({ id }: { id: string }) {
  const [state, action] = useActionState(voidPaymentAction, initialFormState);
  const [open, setOpen] = useState(false);
  if (state.ok) return <FormAlert state={state} />;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-slate-500 hover:text-red-700"
      >
        Anular
      </button>
    );
  }
  return (
    <form action={action} className="mt-2 space-y-2" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <Field name="reason" label="Por qué se anula" required state={state} />
      <p className="text-xs text-slate-500">
        Si fue con tarjeta, anularlo aquí no devuelve el dinero: la devolución se hace en PixelPay.
      </p>
      <SubmitButton pendingText="Anulando…">Anular pago</SubmitButton>
    </form>
  );
}

/** La familia elige qué pagar y va a la página segura de PixelPay. */
export function PayOnlineForm({
  studentId,
  charges,
  email,
}: {
  studentId: string;
  charges: ChargeDto[];
  email: string;
}) {
  const [state, action] = useActionState<CheckoutState, FormData>(payOnlineAction, initialFormState);
  const shown = { ...state, values: { email, ...state.values } };
  const router = useRouter();
  // Con la orden firmada lista se abre la página segura de PixelPay (los campos van en la dirección,
  // como permite su Hosted Payment). En la app de Android se abre en el navegador del teléfono, donde la
  // verificación del banco funciona completa; al volver a la app se actualiza el estado de cuenta.
  const url = state.checkout
    ? `${state.checkout.action}?${new URLSearchParams(state.checkout.fields).toString()}`
    : null;
  useEffect(() => {
    if (!url) return;
    window.location.assign(url);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [url, router]);
  if (url) {
    return (
      <div className="space-y-2 text-sm text-slate-600">
        <p>
          Se abrió la página segura de PixelPay. Cuando termines de pagar, vuelve aquí: tu pago aparecerá en
          tus recibos.
        </p>
        <a href={url} className="btn-primary inline-flex" rel="noopener">
          Abrir la página de pago
        </a>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="studentId" value={studentId} />
      <PendingCharges charges={charges} />
      <Field
        name="email"
        label="Correo para el comprobante"
        type="email"
        autoComplete="email"
        required
        state={shown}
      />
      <SubmitButton pendingText="Abriendo el pago seguro…">Pagar con tarjeta</SubmitButton>
      <p className="text-xs text-slate-500">
        Pagas en la página segura de PixelPay (todas las tarjetas, con verificación de tu banco). CONECTA no
        ve los datos de tu tarjeta.
      </p>
    </form>
  );
}

/** La dirección conecta la cuenta de PixelPay del centro. */
export function PaymentSettingsForm({ settings }: { settings: PaymentSettingsDto }) {
  const [state, action] = useActionState(savePaymentSettingsAction, initialFormState);
  const v = { endpoint: settings.endpoint, keyId: settings.keyId, mode: settings.mode, ...state.values };
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormAlert state={state} />
      <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
          className="size-4 accent-brand-600"
        />
        Las familias pueden pagar con tarjeta en línea
      </label>
      <SelectField
        name="mode"
        label="Modo"
        defaultValue={v.mode}
        options={[
          { value: "sandbox", label: "Prueba (sandbox): no se cobra de verdad" },
          { value: "produccion", label: "Producción: cobros reales" },
        ]}
        state={state}
      />
      <Field
        name="endpoint"
        label="Dominio del comercio en PixelPay"
        placeholder="pixelpay.app"
        required
        state={{ ...state, values: v }}
      />
      <Field name="keyId" label="Key ID" required state={{ ...state, values: v }} />
      <Field
        name="secretKey"
        label="Secret Key"
        type="password"
        autoComplete="off"
        hint={
          settings.hasSecret
            ? "Ya hay una guardada (no se muestra). Escribe otra solo si quieres cambiarla."
            : "Se guarda cifrada y nunca se vuelve a mostrar."
        }
        state={state}
      />
      <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
    </form>
  );
}
