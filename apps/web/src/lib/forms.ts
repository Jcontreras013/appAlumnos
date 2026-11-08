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

/**
 * Ejecuta una server action estándar: valida con Zod, llama al servicio y devuelve el estado del
 * formulario (mensaje de éxito, errores por campo o el error del servicio).
 */
export async function runFormAction<S extends import("zod").ZodType>(
  formData: FormData,
  options: {
    schema: S;
    fields: readonly string[];
    build?: (values: Record<string, string>) => unknown;
    submit: (data: import("zod").output<S>) => Promise<string>;
  },
): Promise<FormState> {
  const values = formValues(formData, options.fields);
  const parsed = options.schema.safeParse(options.build ? options.build(values) : values);
  if (!parsed.success) return { ...fromZodError(parsed.error), values };
  try {
    return { ok: true, message: await options.submit(parsed.data) };
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
}
