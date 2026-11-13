"use server";

import { announcementInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

export async function publishAnnouncementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await requireRole("admin", "coordinador", "secretaria");
  return runFormAction(formData, {
    schema: announcementInputSchema,
    fields: ["title", "body", "audience", "sectionId", "expiresOn"],
    submit: async (input) => {
      await academic.publishAnnouncement(accessToken, input);
      revalidatePath("/panel/avisos");
      return `Aviso «${input.title}» publicado.`;
    },
  });
}

export async function removeAnnouncementAction(formData: FormData) {
  const { accessToken } = await requireRole("admin", "coordinador", "secretaria");
  await academic.removeAnnouncement(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/avisos");
}
