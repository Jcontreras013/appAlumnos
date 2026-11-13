import { todayInHonduras } from "@escolar/shared";
import type { Metadata } from "next";
import { AnnouncementList } from "@/components/announcement-list";
import { academic } from "@/lib/academic";
import { requireRole } from "@/lib/dal";
import { removeAnnouncementAction } from "./actions";
import { AnnouncementForm } from "./announcement-form";

export const metadata: Metadata = { title: "Avisos" };

export default async function AnnouncementsPage() {
  const session = await requireRole("admin", "coordinador", "secretaria", "docente");
  const canPublish = session.user.role !== "docente";
  const [items, sections] = await Promise.all([
    academic.announcements(session.accessToken),
    canPublish ? academic.listSections(session.accessToken) : Promise.resolve([]),
  ]);
  const today = todayInHonduras();
  const current = items.filter((a) => a.expiresOn >= today);
  const expired = items.filter((a) => a.expiresOn < today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Avisos</h1>
        <p className="mt-1 text-sm text-slate-500">
          {canPublish
            ? "Lo que publiques aquí lo ve el personal o las familias en su panel mientras esté vigente."
            : "Avisos de la dirección para el personal."}
        </p>
      </div>
      <div className={`grid gap-6 ${canPublish ? "lg:grid-cols-[1fr_22rem]" : ""}`}>
        <section className="space-y-6">
          {current.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-500">No hay avisos vigentes.</p>
          ) : (
            <AnnouncementList
              items={current}
              showAudience={canPublish}
              action={(a) =>
                a.canDelete && canPublish ? (
                  <form action={removeAnnouncementAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="text-xs font-semibold text-slate-500 hover:text-red-700">
                      Quitar
                    </button>
                  </form>
                ) : null
              }
            />
          )}
          {canPublish && expired.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-600">
                Vencidos este mes ({expired.length})
              </summary>
              <div className="mt-3 opacity-70">
                <AnnouncementList items={expired} showAudience />
              </div>
            </details>
          )}
        </section>
        {canPublish && (
          <aside className="card h-fit p-5">
            <h2 className="mb-4 font-semibold text-slate-900">Nuevo aviso</h2>
            <AnnouncementForm sections={sections.map((s) => ({ value: s.id, label: s.label }))} />
          </aside>
        )}
      </div>
    </div>
  );
}
