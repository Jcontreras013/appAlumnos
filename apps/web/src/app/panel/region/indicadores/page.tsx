import {
  formatDay,
  isIsoDate,
  PILOT_GOALS,
  PILOT_INDICATORS,
  type PilotIndicator,
  type PilotMeasure,
  pilotRate,
} from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";

export const metadata: Metadata = { title: "Indicadores del piloto" };

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)} %`);

/** Cumple · no cumple · sin datos, según la meta de la propuesta. */
function status(indicator: PilotIndicator, m: PilotMeasure) {
  const rate = pilotRate(m);
  if (rate === null) return { label: "Sin datos", style: "bg-slate-100 text-slate-600" } as const;
  return rate >= PILOT_GOALS[indicator].goal
    ? ({ label: "Cumple", style: "bg-brand-50 text-brand-800" } as const)
    : ({ label: "No cumple", style: "bg-red-100 text-red-800" } as const);
}

const sum = (list: PilotMeasure[]): PilotMeasure => ({
  met: list.reduce((acc, m) => acc + m.met, 0),
  total: list.reduce((acc, m) => acc + m.total, 0),
});

export default async function PilotPage({ searchParams }: PageProps<"/panel/region/indicadores">) {
  const session = await requireRole("director_departamental", "director_distrital", "superadmin");
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const desde = isIsoDate(one(params.desde)) ? one(params.desde) : undefined;
  const hasta = isIsoDate(one(params.hasta)) ? one(params.hasta) : undefined;
  const distrito = one(params.distrito);

  const data = await academic.pilotIndicators(session.accessToken, desde, hasta);
  const districts = [...new Set(data.schools.map((s) => s.districtName).filter(Boolean))] as string[];
  // El piloto suele ser un distrito: al filtrar, los totales son los de ese distrito.
  const schools = data.schools.filter((s) => !distrito || s.districtName === distrito);
  const totals = Object.fromEntries(
    PILOT_INDICATORS.map((k) => [k, sum(schools.map((s) => s.measures[k]))]),
  ) as Record<PilotIndicator, PilotMeasure>;
  const reached = PILOT_INDICATORS.filter((k) => status(k, totals[k]).label === "Cumple").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm">
            <Link href="/panel/region" className="text-brand-700 hover:underline">
              ← Tablero de centros
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Indicadores del piloto</h1>
          <p className="mt-1 text-sm text-slate-500">
            {distrito || session.current.scopeName} · del {formatDay(data.from)} al {formatDay(data.to)} ·{" "}
            {data.businessDays} días hábiles · {schools.length} {schools.length === 1 ? "centro" : "centros"}
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2">
          {districts.length > 1 && (
            <select name="distrito" defaultValue={distrito} aria-label="Distrito" className="input w-48">
              <option value="">Todos los distritos</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <label className="text-sm text-slate-600">
            <span className="label">Desde</span>
            <input type="date" name="desde" defaultValue={data.from} className="input w-40" />
          </label>
          <label className="text-sm text-slate-600">
            <span className="label">Hasta</span>
            <input type="date" name="hasta" defaultValue={data.to} className="input w-40" />
          </label>
          <button type="submit" className="btn-secondary">
            Ver
          </button>
        </form>
      </div>

      <p
        role="status"
        className={`rounded-xl border p-4 text-sm ${
          reached === PILOT_INDICATORS.length
            ? "border-brand-100 bg-brand-50 text-brand-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        <strong>
          {reached} de {PILOT_INDICATORS.length} metas cumplidas
        </strong>{" "}
        en este período. Las metas son las de la propuesta; se miden con los datos de la plataforma, sin
        encuestas aparte.
      </p>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Indicador</th>
                <th className="px-4 py-3 font-semibold">Meta</th>
                <th className="px-4 py-3 text-right font-semibold">Resultado</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PILOT_INDICATORS.map((k) => {
                const m = totals[k];
                const st = status(k, m);
                return (
                  <tr key={k}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{PILOT_GOALS[k].label}</p>
                      <p className="text-xs text-slate-500">{PILOT_GOALS[k].how}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{PILOT_GOALS[k].goalText}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      <span className="text-base font-semibold text-slate-900">{pct(pilotRate(m))}</span>
                      <span className="block text-xs text-slate-500">
                        {m.met} de {m.total}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${st.style}`}
                      >
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
          Por centro
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Centro</th>
                {PILOT_INDICATORS.map((k) => (
                  <th key={k} className="px-3 py-2 text-right font-semibold" title={PILOT_GOALS[k].label}>
                    {SHORT[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schools.map((s) => (
                <tr key={s.schoolId}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/panel/region/${s.schoolId}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {s.schoolName}
                    </Link>
                    {s.districtName && <span className="block text-xs text-slate-500">{s.districtName}</span>}
                  </td>
                  {PILOT_INDICATORS.map((k) => {
                    const m = s.measures[k];
                    const st = status(k, m);
                    const tone =
                      st.label === "Cumple"
                        ? "text-brand-700"
                        : st.label === "No cumple"
                          ? "font-semibold text-red-700"
                          : "text-slate-400";
                    return (
                      <td
                        key={k}
                        className={`px-3 py-2 text-right tabular-nums ${tone}`}
                        title={`${PILOT_GOALS[k].label}: ${m.met} de ${m.total}`}
                      >
                        {k === "centros_activos" ? (m.met ? "Sí" : "No") : pct(pilotRate(m))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Encabezados cortos de la tabla por centro (el nombre completo va en el título de la columna). */
const SHORT: Record<PilotIndicator, string> = {
  centros_activos: "Cuentas activas",
  asistencia: "Asistencia",
  notas: "Notas",
  planificacion: "Planificación",
  licencias: "Licencias",
  alerta_temprana: "Alerta temprana",
  familias: "Familias",
};
