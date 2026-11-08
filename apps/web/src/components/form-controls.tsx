"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form-state";

export function SubmitButton({ children, pendingText }: { children: ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full sm:w-auto" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function Field({
  name,
  label,
  state,
  hint,
  ...input
}: {
  name: string;
  label: string;
  state: FormState;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = state.fields?.[name];
  const id = `campo-${name}`;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        className="input"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        defaultValue={state.values?.[name]}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormAlert({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </div>
    );
  }
  if (state.ok && state.message) {
    return (
      <div
        role="status"
        className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-900"
      >
        {state.message}
      </div>
    );
  }
  return null;
}

export function SelectField({
  name,
  label,
  state,
  options,
  placeholder,
  defaultValue,
  ...select
}: {
  name: string;
  label: string;
  state: FormState;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const error = state.fields?.[name];
  const id = `campo-${name}`;
  const value = state.values?.[name] ?? (defaultValue as string | undefined) ?? "";
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {/* La key vuelve a montar el select con el valor elegido cuando hay un error (React reinicia el form). */}
      <select
        key={value || "vacio"}
        id={id}
        name={name}
        className="input"
        defaultValue={value}
        aria-invalid={Boolean(error)}
        {...select}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  state,
  hint,
  ...textarea
}: {
  name: string;
  label: string;
  state: FormState;
  hint?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = state.fields?.[name];
  const id = `campo-${name}`;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        className="input min-h-20"
        aria-invalid={Boolean(error)}
        defaultValue={state.values?.[name]}
        {...textarea}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
