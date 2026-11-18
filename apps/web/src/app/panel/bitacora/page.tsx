import { type AuditEventDto, auditLabel, formatDate } from "@escolar/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, FilterEmpty, FilterRow, FilterScope } from "@/components/quick-filter";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { identity } from "@/lib/identity";

export const metadata: Metadata = { title: "Bitácora" };

const PAGE = 50;
/** Datos que ayudan a entender un evento sin mostrar identidades ni correos. */
const DETAIL_KEYS: Record<string, string> = {
  name: "",
  title: "",
  label: "",
  teacher: "",
  from: "de",
  to: "a",
  kind: "",
  students: "alumnos",
  created: "creados",
  schools: "centros",
};

function detail(e: AuditEventDto): string {
  if (!e.data) return "";
  return Object.entries(DETAIL_KEYS)
    .filter(([key]) => {
      const v = e.data?.[key];
      return typeof v === "string" || typeof v === "number";
    })
    .map(([key, prefix]) => `${prefix ? `${prefix} ` : ""}${String(e.data?.[key])}`)
    .join(" · ");
}

/**
 * Bitácora del centro: quién hizo qué y cuándo (accesos, cuentas, alumnos, estructura, licencias,
 * descargas…). Une lo registrado en los dos servicios. Nadie la puede modificar.
 */
export default async function AuditPage({ searchParams }: PageProps<"/panel/bitacora">) {
  const session = await requireRole("admin");
  const { antes } = await searchParams;
  const before = typeof antes === "string" && !Number.isNaN(Date.parse(antes)) ? antes : undefined;
  const token = session.accessToken;
  const [fromAcademic, fromIdentity, staff, families] = await Promise.all([
    academic.auditLog(token, before),
    identity.auditLog(token, before),
    identity.listUsers(token),
    identity.listUsers(token, "padre").catch(() => []),
  ]);
  const names = new Map([...staff, ...families].map((u) => [u.id, u.name]));
  const events = [...fromAcademic, ...fromIdentity]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, PAGE);
  const older = events.length === PAGE ? events.at(-1)?.createdAt : undefined;
  const rows = events.map((e) => {
    const target =
      e.entityType === "user" && e.entityId && e.entityId !== e.actorUserId
        ? names.get(e.entityId)
        : undefined;
    const extra = [target, detail(e)].filter(Boolean).join(" · ");
    const actor = e.actorUserId ? (names.get(e.actorUserId) ?? "Otra cuenta") : "Sistema";
    return { e, actor, extra, text: `${actor} ${auditLabel(e.action)} ${extra}` };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Bitácora</h1>
        <p className="mt-1 text-sm text-slate-500">
          Quién hizo qué y cuándo en {session.school?.name}. Se registra solo y nadie la puede modificar.
        </p>
      </div>
      <section className="card overflow-hidden">
        {events.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">Todavía no hay movimientos.</p>
        ) : (
          <FilterScope items={rows.map((r) => ({ text: r.text }))}>
            <FilterBar placeholder="Buscar en esta página: persona o acción" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Cuándo</th>
                    <th className="px-4 py-3 font-semibold">Quién</th>
                    <th className="px-4 py-3 font-semibold">Qué</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ e, actor, extra, text }) => {
                    return (
                      <FilterRow key={`${e.source}-${e.id}`} text={text}>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-600">
                          {formatDate(e.createdAt)}{" "}
                          {new Date(e.createdAt).toLocaleTimeString("es-HN", {
                            timeZone: "America/Tegucigalpa",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-4 py-2">{actor}</td>
                        <td className="px-4 py-2">
                          <span className="text-slate-900">{auditLabel(e.action)}</span>
                          {extra && <span className="block text-xs text-slate-500">{extra}</span>}
                        </td>
                      </FilterRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <FilterEmpty message="Nada en esta página coincide con la búsqueda." />
          </FilterScope>
        )}
      </section>
      <div className="flex gap-4 text-sm">
        {before && (
          <Link href="/panel/bitacora" className="font-semibold text-brand-700 hover:underline">
            ← Lo más reciente
          </Link>
        )}
        {older && (
          <Link
            href={`/panel/bitacora?antes=${encodeURIComponent(older)}`}
            className="font-semibold text-brand-700 hover:underline"
          >
            Ver más antiguos →
          </Link>
        )}
      </div>
    </div>
  );
}
