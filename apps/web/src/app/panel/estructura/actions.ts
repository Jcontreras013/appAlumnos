"use server";

import {
  assignmentInputSchema,
  gradeInputSchema,
  schoolYearInputSchema,
  sectionInputSchema,
  subjectInputSchema,
} from "@escolar/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import type { FormState } from "@/lib/form-state";
import { runFormAction } from "@/lib/forms";

const writer = () => requireRole("admin", "coordinador");
const done = (message: string) => {
  revalidatePath("/panel/estructura");
  return message;
};

export async function createYearAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: schoolYearInputSchema,
    fields: ["name", "startsOn", "endsOn"],
    submit: async (input) => {
      const year = await academic.createYear(accessToken, input);
      return done(`Año lectivo ${year.name} creado${year.isCurrent ? " y marcado como vigente" : ""}.`);
    },
  });
}

export async function setCurrentYearAction(formData: FormData) {
  const { accessToken } = await writer();
  await academic.setCurrentYear(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/estructura");
}

export async function createGradeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: gradeInputSchema,
    fields: ["name", "sortOrder"],
    submit: async (input) => done(`Grado "${(await academic.createGrade(accessToken, input)).name}" creado.`),
  });
}

export async function createSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: sectionInputSchema,
    fields: ["schoolYearId", "gradeId", "name", "capacity"],
    submit: async (input) =>
      done(`Sección ${(await academic.createSection(accessToken, input)).label} creada.`),
  });
}

export async function createSubjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: subjectInputSchema,
    fields: ["name"],
    submit: async ({ name }) =>
      done(`Materia "${(await academic.createSubject(accessToken, name)).name}" creada.`),
  });
}

export async function createAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { accessToken } = await writer();
  return runFormAction(formData, {
    schema: assignmentInputSchema,
    fields: ["sectionId", "subjectId", "teacherUserId"],
    submit: async (input) => {
      const a = await academic.createAssignment(accessToken, input);
      return done(`${a.teacherName} dará ${a.subjectName} en ${a.sectionLabel}.`);
    },
  });
}

export async function deleteAssignmentAction(formData: FormData) {
  const { accessToken } = await writer();
  await academic.deleteAssignment(accessToken, z.uuid().parse(formData.get("id")));
  revalidatePath("/panel/estructura");
}
