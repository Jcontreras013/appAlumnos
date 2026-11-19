"use client";

import {
  CONDUCT_CATEGORIES,
  CONDUCT_CATEGORY_LABELS,
  CONDUCT_MEASURE_LABELS,
  CONDUCT_MEASURES,
  CONDUCT_SEVERITIES,
  CONDUCT_SEVERITY_LABELS,
  type ConductStudentOptionDto,
  DIRECTOR_ONLY_MEASURES,
  MAX_SUSPENSION_DAYS,
  matchesSearch,
} from "@escolar/shared";
import { useActionState, useState } from "react";
import {
  addMeasureAction,
  cancelMeasureAction,
  deleteIncidentAction,
  reportIncidentAction,
} from "@/app/panel/conducta/actions";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";

/**
 * Reportar un incidente. Con `student` fijo (desde la ficha) no se elige alumno; si no, se busca por
 * nombre entre los alumnos que quien reporta puede reportar (el maestro, los de sus secciones).
 */
export function ReportIncidentForm({
  students = [],
  student,
  today,
}: {
  students?: ConductStudentOptionDto[];
  student?: { id: string; name: string };
  today: string;
}) {
  const [state, action] = useActionState(reportIncidentAction, initialFormState);
  const [query, setQuery] = useState("");
  const shown = students.filter((s) => matchesSearch(`${s.name} ${s.sectionLabel}`, query));
  const values = { date: today, ...state.values };
  const withDefaults = { ...state, values };
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ? state.message : "reporte"}>
      <FormAlert state={state} />
      {student ? (
        <input type="hidden" name="studentId" value={student.id} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="conducta-buscar" className="label">
              Buscar alumno
            </label>
            <input
              id="conducta-buscar"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre o sección"
              autoComplete="off"
              className="input"
            />
          </div>
          <SelectField
            name="studentId"
            label={`Alumno (${shown.length})`}
            state={withDefaults}
            placeholder="Elige al alumno…"
            options={shown.map((s) => ({ value: s.studentId, label: `${s.name} · ${s.sectionLabel}` }))}
            idPrefix="conducta"
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name="date" label="Fecha" type="date" max={today} state={withDefaults} idPrefix="conducta" />
        <SelectField
          name="severity"
          label="Gravedad"
          state={withDefaults}
          placeholder="Elige…"
          options={CONDUCT_SEVERITIES.map((v) => ({ value: v, label: CONDUCT_SEVERITY_LABELS[v] }))}
          idPrefix="conducta"
        />
        <SelectField
          name="category"
          label="Tipo de falta"
          state={withDefaults}
          placeholder="Elige…"
          options={CONDUCT_CATEGORIES.map((v) => ({ value: v, label: CONDUCT_CATEGORY_LABELS[v] }))}
          idPrefix="conducta"
        />
      </div>
      <TextAreaField
        name="description"
        label="¿Qué pasó?"
        state={withDefaults}
        hint="Lo ve el personal del centro. La familia ve el tipo de falta y las medidas, no esta descripción."
        idPrefix="conducta"
      />
      <SubmitButton pendingText="Registrando…">Registrar incidente</SubmitButton>
    </form>
  );
}

/** Registrar una medida para un incidente. La suspensión pide su último día; la expulsión, confirmar. */
export function MeasureForm({
  incidentId,
  studentId,
  canSuspendOrExpel,
  minDate,
  today,
}: {
  incidentId: string;
  studentId: string;
  canSuspendOrExpel: boolean;
  /** No antes del incidente. */
  minDate: string;
  today: string;
}) {
  const [state, action] = useActionState(
    addMeasureAction.bind(null, { incidentId, studentId }),
    initialFormState,
  );
  const [kind, setKind] = useState(state.values?.kind ?? "");
  const kinds = CONDUCT_MEASURES.filter((k) => canSuspendOrExpel || !DIRECTOR_ONLY_MEASURES.includes(k));
  const values = { startsOn: today, ...state.values };
  const withDefaults = { ...state, values };
  const prefix = `medida-${incidentId}`;
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ? state.message : "medida"}>
      <FormAlert state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          name="kind"
          label="Medida"
          state={withDefaults}
          placeholder="Elige…"
          options={kinds.map((k) => ({ value: k, label: CONDUCT_MEASURE_LABELS[k] }))}
          onChange={(e) => setKind(e.target.value)}
          idPrefix={prefix}
        />
        <Field
          name="startsOn"
          label={kind === "suspension" ? "Primer día" : "Fecha"}
          type="date"
          min={minDate}
          max={kind === "expulsion" ? today : undefined}
          state={withDefaults}
          idPrefix={prefix}
        />
        {kind === "suspension" && (
          <Field
            name="endsOn"
            label="Último día"
            type="date"
            min={minDate}
            state={withDefaults}
            hint={`Máximo ${MAX_SUSPENSION_DAYS} días`}
            idPrefix={prefix}
          />
        )}
      </div>
      <TextAreaField
        name="notes"
        label={kind === "llamado_atencion" ? "Nota" : "Nota para la familia"}
        state={withDefaults}
        hint={
          kind === "llamado_atencion"
            ? "Qué se le dijo al alumno. Si avisas a la familia, la ve en su portal."
            : "La familia la ve en su portal: qué se decidió y qué se espera."
        }
        idPrefix={prefix}
      />
      {kind === "llamado_atencion" && (
        // La citación, el compromiso, la suspensión y la expulsión siempre se le avisan a la familia.
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="notifyFamily"
            className="mt-0.5"
            defaultChecked={state.values?.notifyFamily === "on"}
          />
          <span>
            <strong>Avisar a la familia.</strong> Si no lo marcas, el llamado queda solo en el registro del
            centro.
          </span>
        </label>
      )}
      {kind === "expulsion" && (
        <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <input type="checkbox" name="confirm" className="mt-0.5" />
          <span>
            Entiendo que la expulsión <strong>retira la matrícula</strong> del alumno con esta fecha. Si
            después se anula, hay que volver a matricularlo desde su ficha.
          </span>
        </label>
      )}
      <SubmitButton pendingText="Registrando…">Registrar medida</SubmitButton>
    </form>
  );
}

/** Anular una medida registrada por error (solo la dirección). */
export function CancelMeasureButton({
  measureId,
  studentId,
  label,
}: {
  measureId: string;
  studentId: string;
  label: string;
}) {
  const [state, action] = useActionState(
    cancelMeasureAction.bind(null, { measureId, studentId }),
    initialFormState,
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`¿Anular «${label}»? Queda en el historial como anulada.`)) e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" className="text-xs font-semibold text-slate-500 hover:text-red-700">
        Anular
      </button>
      {state.error && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

/** Borrar un reporte hecho por error (mientras no tenga medidas). */
export function DeleteIncidentButton({ incidentId, studentId }: { incidentId: string; studentId: string }) {
  const [state, action] = useActionState(
    deleteIncidentAction.bind(null, { incidentId, studentId }),
    initialFormState,
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("¿Borrar este reporte? Solo se puede porque todavía no tiene medidas."))
          e.preventDefault();
      }}
      className="inline"
    >
      <button type="submit" className="text-xs font-semibold text-slate-500 hover:text-red-700">
        Borrar reporte
      </button>
      {state.error && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
