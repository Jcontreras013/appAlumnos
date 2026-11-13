import { z } from "zod";
import { REGIONAL_ROLES, SCHOOL_ROLES } from "./roles";

/** Esquemas de validación compartidos entre el frontend (Next.js) y los servicios. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Correo electrónico inválido" }));

export const passwordSchema = z
  .string()
  .min(10, { error: "La contraseña debe tener al menos 10 caracteres" })
  .max(200, { error: "La contraseña es demasiado larga" });

/**
 * Se entra con el correo o con el número de identidad (muchas familias no usan correo). El campo se
 * sigue llamando `email` en la API por compatibilidad; `loginIdentifier` decide qué es.
 */
export const loginInputSchema = z.object({
  email: z
    .string({ error: "Escribe tu correo o tu número de identidad" })
    .trim()
    .min(3, { error: "Escribe tu correo o tu número de identidad" })
    .max(200),
  password: z.string({ error: "Escribe tu contraseña" }).min(1, { error: "Escribe tu contraseña" }).max(200),
});

/** "0801-1985-01234" o "0801198501234" => identidad; cualquier otra cosa => correo en minúsculas. */
export function loginIdentifier(value: string): { nationalId: string } | { email: string } {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[\s-]/g, "");
  if (/^\d{13}$/.test(digits)) return { nationalId: digits };
  return { email: trimmed.toLowerCase() };
}

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Escribe tu contraseña actual" }).max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    error: "La contraseña nueva debe ser distinta de la actual",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});

export const schoolSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: "Usa solo minúsculas, números y guiones (ej. colegio-san-jose)",
  })
  .min(3)
  .max(60);

/** RTN hondureño: 14 dígitos. Se aceptan guiones o espacios al escribirlo. */
export const rtnSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{14}$/, { error: "El RTN debe tener 14 dígitos" }));

export const personNameSchema = z.string().trim().min(2, { error: "Nombre demasiado corto" }).max(150);

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/**
 * Alta de una persona del centro. Entra con su correo o su identidad; si no se le pone contraseña,
 * se genera una temporal que debe cambiar al entrar.
 */
export const createUserInputSchema = z
  .object({
    name: personNameSchema,
    email: z.preprocess(blankToUndefined, emailSchema.optional()),
    nationalId: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .transform((v) => v.replace(/\D/g, ""))
        .pipe(z.string().regex(/^\d{13}$/, { error: "La identidad debe tener 13 dígitos" }))
        .optional(),
    ),
    password: z.preprocess(blankToUndefined, passwordSchema.optional()),
    role: z.enum(SCHOOL_ROLES, { error: "Rol inválido" }),
  })
  .refine((v) => v.email || v.nationalId, {
    error: "Escribe el correo o el número de identidad (con eso entrará)",
    path: ["nationalId"],
  });
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const createSchoolInputSchema = z.object({
  name: z.string().trim().min(3).max(200),
  slug: schoolSlugSchema,
  rtn: rtnSchema.optional(),
  code: z.string().trim().min(3).max(30).optional(),
  sector: z.enum(["publico", "privado"]).default("privado"),
  districtId: z.uuid().optional(),
  admin: z.object({
    name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type CreateSchoolInput = z.infer<typeof createSchoolInputSchema>;

/** Logo del colegio: PNG, JPG o WebP de hasta 300 KB. SVG no, porque puede contener código. */
export const LOGO_MAX_BYTES = 300 * 1024;
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

export const logoInputSchema = z.object({
  /** Imagen en base64 (con o sin el prefijo "data:image/...;base64,"). */
  image: z
    .string()
    .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 100, { error: "El logo pesa más de 300 KB" })
    .transform((v) => v.replace(/^data:[^;]+;base64,/, "")),
});

// ───────────────────────────── Jerarquía (Secretaría de Educación) ─────────────────────────────

export const departmentInputSchema = z.object({
  /** Código oficial del departamento (01 a 18). */
  code: z
    .string()
    .trim()
    .regex(/^\d{2}$/, { error: "El código tiene 2 dígitos (ej. 11)" }),
  name: z.string().trim().min(3).max(80),
});

export const districtInputSchema = z.object({ name: z.string().trim().min(3).max(80) });

export const regionalUserInputSchema = z
  .object({
    name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(REGIONAL_ROLES, { error: "Rol inválido" }),
    departmentId: z.uuid().optional(),
    districtId: z.uuid().optional(),
  })
  .refine(
    (v) =>
      v.role === "director_departamental" ? v.departmentId && !v.districtId : v.districtId && !v.departmentId,
    {
      error: "La dirección departamental va con un departamento y la distrital con un distrito",
      path: ["role"],
    },
  );
export type RegionalUserInput = z.infer<typeof regionalUserInputSchema>;

export const switchMembershipInputSchema = z.object({
  membershipId: z.uuid(),
  refreshToken: z.string().min(20).max(200).optional(),
});

/** Cuenta del portal para un padre, madre o encargado: se identifica con correo o identidad. */
export const familyAccountInputSchema = z
  .object({
    name: personNameSchema,
    email: emailSchema.optional(),
    nationalId: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().regex(/^\d{13}$/, { error: "La identidad debe tener 13 dígitos" }))
      .optional(),
  })
  .refine((v) => v.email || v.nationalId, {
    error: "Hace falta el correo o el número de identidad del encargado",
    path: ["nationalId"],
  });
export type FamilyAccountInput = z.infer<typeof familyAccountInputSchema>;

const blankToNull = (v: unknown) =>
  v === undefined || (typeof v === "string" && v.trim() === "") ? null : v;

/**
 * Corregir los datos de una cuenta (un nombre mal escrito, una identidad equivocada). Vacío = quitar
 * ese dato, pero siempre debe quedar con qué entrar: el correo o la identidad.
 */
export const accountUpdateSchema = z
  .object({
    name: personNameSchema,
    email: z.preprocess(blankToNull, emailSchema.nullable()),
    nationalId: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .transform((v) => v.replace(/\D/g, ""))
        .pipe(z.string().regex(/^\d{13}$/, { error: "La identidad debe tener 13 dígitos" }))
        .nullable(),
    ),
  })
  .refine((v) => v.email || v.nationalId, {
    error: "Debe quedar el correo o el número de identidad (con eso entra)",
    path: ["nationalId"],
  });
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;

/**
 * Cargos del personal que se asignan en un centro público. Las familias se manejan aparte (desde la
 * ficha del alumno) y "finanzas" queda reservado para colegios privados.
 */
export const STAFF_ROLES = ["admin", "coordinador", "secretaria", "docente"] as const;

/** Cualquier acceso de personal (incluido "finanzas") se puede cambiar a uno de STAFF_ROLES. */
const ANY_STAFF_ROLE = SCHOOL_ROLES.filter((r) => r !== "padre") as Exclude<
  (typeof SCHOOL_ROLES)[number],
  "padre"
>[];

export const roleChangeSchema = z.object({
  from: z.enum(ANY_STAFF_ROLE, { error: "Cargo inválido" }),
  to: z.enum(STAFF_ROLES, { error: "Elige el cargo nuevo" }),
});
export type RoleChange = z.infer<typeof roleChangeSchema>;

/** Segundo paso del inicio de sesión: el código de la app (6 dígitos) o uno de recuperación. */
export const mfaLoginInputSchema = z.object({
  challenge: z.string().min(20).max(200),
  code: z
    .string({ error: "Escribe el código" })
    .trim()
    .min(6, { error: "Escribe el código de 6 dígitos de tu app" })
    .max(20, { error: "Código inválido" }),
});

export const mfaCodeInputSchema = z.object({
  code: z
    .string({ error: "Escribe el código" })
    .trim()
    .regex(/^\d{6}$/, { error: "Escribe los 6 dígitos que muestra la app" }),
});
