"use server";

import { createSchoolInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { formValues, fromServiceError, fromZodError } from "@/lib/forms";
import { identity } from "@/lib/identity";

const FIELDS = ["name", "slug", "rtn", "admin.name", "admin.email"] as const;

export async function createSchoolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireRole("superadmin");
  const values = formValues(formData, FIELDS);
  const parsed = createSchoolInputSchema.safeParse({
    name: values.name,
    slug: values.slug,
    rtn: values.rtn || undefined,
    admin: {
      name: values["admin.name"],
      email: values["admin.email"],
      password: formData.get("admin.password"),
    },
  });
  if (!parsed.success) return { ...fromZodError(parsed.error), values };

  try {
    const { school, admin } = await identity.createSchool(session.accessToken, parsed.data);
    revalidatePath("/panel/colegios");
    return { ok: true, message: `Se creó ${school.name}. Su administrador entra con ${admin.email}.` };
  } catch (err) {
    return { ...fromServiceError(err), values };
  }
}

const toggleSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

export async function setSchoolActiveAction(formData: FormData) {
  const session = await requireRole("superadmin");
  const { id, active } = toggleSchema.parse({ id: formData.get("id"), active: formData.get("active") });
  await identity.setSchoolActive(session.accessToken, id, active === "true");
  revalidatePath("/panel/colegios");
}
