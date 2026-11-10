import { emailSchema, formatNationalId, personNameSchema } from "@escolar/shared";

/** Identidad y correo de una fila del Excel, con los errores en palabras de la persona que lo llenó. */
export function identifiersOf(rawNationalId: string | undefined, rawEmail: string | undefined) {
  const errors: string[] = [];
  let nationalId: string | undefined;
  let email: string | undefined;
  const dni = (rawNationalId ?? "").replace(/\D/g, "");
  // Excel convierte "0801…" en número y se come el cero inicial.
  const fixed = dni.length === 12 ? `0${dni}` : dni;
  if ((rawNationalId ?? "").trim()) {
    if (/^\d{13}$/.test(fixed)) nationalId = fixed;
    else errors.push("La identidad debe tener 13 dígitos");
  }
  if ((rawEmail ?? "").trim()) {
    const parsed = emailSchema.safeParse(rawEmail);
    if (parsed.success) email = parsed.data;
    else errors.push("Correo inválido");
  }
  if (!nationalId && !email && errors.length === 0) {
    errors.push("Falta la identidad o el correo (con eso entrará)");
  }
  return { nationalId, email, errors };
}

export function nameOf(raw: string | undefined, missing: string): { name: string; error?: string } {
  const parsed = personNameSchema.safeParse(raw ?? "");
  return parsed.success ? { name: parsed.data } : { name: (raw ?? "").trim(), error: missing };
}

export const loginLabel = (ids: { nationalId?: string | null; email?: string | null }) =>
  ids.nationalId ? formatNationalId(ids.nationalId) : (ids.email ?? null);

/** "Escuela Demo Coxen Hole" => "escuela-demo-coxen-hole" (identificador del centro). */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "") || "centro"
  );
}

/** Para comparar nombres escritos a mano ("José Santos Guardiola" = "jose santos guardiola"). */
export const comparable = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
