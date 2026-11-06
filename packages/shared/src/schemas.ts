import { z } from "zod";
import { SCHOOL_ROLES } from "./roles";

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
  admin: z.object({
    name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type CreateSchoolInput = z.infer<typeof createSchoolInputSchema>;
