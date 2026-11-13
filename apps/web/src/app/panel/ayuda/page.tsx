import type { Metadata } from "next";
import { PrintButton } from "@/components/print-button";
import { getSession } from "@/lib/dal";
import { guidesFor } from "@/lib/help";

export const metadata: Metadata = { title: "Ayuda" };

/** Manual de uso del cargo de la sesión, listo para imprimir o guardar como PDF. */
export default async function HelpPage() {
  const { user } = await getSession();
  const guides = guidesFor(user.role);
  return (
    <div className="max-w-3xl space-y-8 print:max-w-none">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Ayuda</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cómo usar la plataforma en tu cargo, paso a paso. Puedes imprimirlo o guardarlo como PDF.
          </p>
        </div>
        <PrintButton />
      </div>

      {guides.length > 1 && (
        <nav aria-label="Manuales" className="flex flex-wrap gap-2 print:hidden">
          {guides.map((g) => (
            <a
              key={g.key}
              href={`#${g.key}`}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              {g.title}
            </a>
          ))}
        </nav>
      )}

      {guides.map((guide) => (
        <article
          key={guide.key}
          id={guide.key}
          className="card space-y-5 p-6 print:break-before-page print:border-0 print:shadow-none"
        >
          <header>
            <h2 className="text-xl font-semibold text-slate-900">Manual: {guide.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{guide.intro}</p>
          </header>
          {guide.sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="font-semibold text-slate-900">{section.title}</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {section.tip && (
                <p className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-900">
                  {section.tip}
                </p>
              )}
            </section>
          ))}
        </article>
      ))}
    </div>
  );
}
