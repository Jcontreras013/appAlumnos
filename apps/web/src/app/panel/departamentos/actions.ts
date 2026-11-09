"use server";

import {
  departmentInputSchema,
  districtInputSchema,
  ROLE_LABELS,
  regionalUserInputSchema,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";
import { identity } from "@/lib/identity";

const done = (message: string) => {
  revalidatePath("/panel/departamentos");
  return message;
};

export async function createDepartmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("superadmin");
  return runFormAction(formData, {
    schema: departmentInputSchema,
    fields: ["code", "name"],
    submit: async (input) =>
      done(`Departamento ${(await identity.createDepartment(accessToken, input)).name} creado.`),
  });
}

export async function createDistrictAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("superadmin");
  return runFormAction(formData, {
    schema: districtInputSchema.extend({ departmentId: z.uuid({ error: "Elige el departamento" }) }),
    fields: ["departmentId", "name"],
    submit: async ({ departmentId, name }) => {
      await identity.createDistrict(accessToken, departmentId, name);
      return done(`Distrito ${name} creado.`);
    },
  });
}

export async function createRegionalUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("superadmin");
  return runFormAction(formData, {
    schema: regionalUserInputSchema,
    fields: ["name", "email", "password", "role", "scopeId"],
    // Un solo selector de ámbito: "dep:<id>" o "dis:<id>"
    build: (v) => {
      const [kind, id] = v.scopeId?.split(":") ?? [];
      return {
        name: v.name,
        email: v.email,
        password: formData.get("password"),
        role: kind === "dep" ? "director_departamental" : "director_distrital",
        departmentId: kind === "dep" ? id : undefined,
        districtId: kind === "dis" ? id : undefined,
      };
    },
    submit: async (input) => {
      const user = await identity.createRegionalUser(accessToken, input);
      return done(`${user.name} ya puede entrar como ${ROLE_LABELS[user.role]}.`);
    },
  });
}
