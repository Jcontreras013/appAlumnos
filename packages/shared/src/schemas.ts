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

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Escribe tu contraseña" }).max(200),
});
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

export const createUserInputSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(SCHOOL_ROLES, { error: "Rol inválido" }),
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
