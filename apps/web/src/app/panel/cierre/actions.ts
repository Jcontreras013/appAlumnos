"use server";

import { type PromotionInput, type PromotionSummaryDto, promotionInputSchema } from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { fromServiceError } from "@/lib/forms";

export interface PromotionState {
  result?: PromotionSummaryDto;
  error?: string;
}

/** Revisar (dryRun) o confirmar el paso al año siguiente. */
export async function promoteAction(input: PromotionInput): Promise<PromotionState> {
  const { accessToken } = await requireRole("admin");
  const parsed = promotionInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisa los datos" };
  try {
    const result = await academic.promote(accessToken, parsed.data);
    if (!parsed.data.dryRun) revalidatePath("/panel/cierre");
    return { result };
  } catch (err) {
    return { error: fromServiceError(err).error };
  }
}

/** Prepara el año siguiente con los mismos grados y secciones (y cupos) del año vigente. */
export async function copySectionsAction(formData: FormData) {
  const { accessToken } = await requireRole("admin");
  const toYearId = String(formData.get("toSchoolYearId") ?? "");
  const [current, next] = await Promise.all([
    academic.listSections(accessToken),
    academic.listSections(accessToken, toYearId),
  ]);
  for (const s of current) {
    if (next.some((n) => n.gradeId === s.gradeId && n.name === s.name)) continue;
    await academic.createSection(accessToken, {
      schoolYearId: toYearId,
      gradeId: s.gradeId,
      name: s.name,
      capacity: s.capacity,
    });
  }
  revalidatePath("/panel/cierre");
}
