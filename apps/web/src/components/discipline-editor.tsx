"use client";

import type { DisciplineKind } from "@escolar/shared";
import { addDisciplineAction } from "@/app/panel/disciplina/actions";
import { DisciplineFields } from "@/components/discipline-fields";
import { InlineEditor } from "@/components/inline-editor";

/** Botón «Registrar medida» en la ficha del alumno. */
export function DisciplineEditor({
  studentId,
  studentName,
  kinds,
}: {
  studentId: string;
  studentName: string;
  kinds: readonly DisciplineKind[];
}) {
  return (
    <InlineEditor
      id={studentId}
      what={studentName}
      trigger="Registrar llamado de atención o medida"
      update={addDisciplineAction}
      fields={(state, idPrefix) => <DisciplineFields state={state} kinds={kinds} idPrefix={idPrefix} />}
    />
  );
}
