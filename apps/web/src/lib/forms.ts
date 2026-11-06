import "server-only";
import type { ZodError } from "zod";
import type { FormState } from "./form-state";
import { ServiceError } from "./identity";

export function fromZodError(error: ZodError): FormState {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    fields[key] ??= issue.message;
  }
  return { error: "Revisa los campos marcados", fields };
}

/** Convierte un error de servicio en mensaje para el formulario. Cualquier otro error se relanza. */
export function fromServiceError(err: unknown): FormState {
  if (err instanceof ServiceError) {
    const fields = err.fields ? Object.fromEntries(err.fields.map((f) => [f.path, f.message])) : undefined;
    return { error: err.message, fields };
  }
  throw err;
}

export function formValues(formData: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, String(formData.get(key) ?? "")]));
}
