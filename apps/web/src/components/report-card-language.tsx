import type { Route } from "next";
import Link from "next/link";
import type { ReportCardLanguage } from "@/components/report-card";

/** «Español · English»: la misma boleta en el idioma que entregue el colegio (bilingües). */
export function ReportCardLanguageSwitch({ base, current }: { base: string; current: ReportCardLanguage }) {
  const option = (language: ReportCardLanguage, label: string) =>
    current === language ? (
      <span className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white" aria-current="true">
        {label}
      </span>
    ) : (
      <Link
        href={(language === "es" ? base : `${base}?idioma=en`) as Route}
        className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
        hrefLang={language}
      >
        {label}
      </Link>
    );
  return (
    <nav aria-label="Idioma de la boleta" className="flex items-center gap-1 text-sm">
      {option("es", "Español")}
      {option("en", "English")}
    </nav>
  );
}

export const reportCardLanguageOf = (
  query: Record<string, string | string[] | undefined>,
): ReportCardLanguage =>
  (Array.isArray(query.idioma) ? query.idioma[0] : query.idioma) === "en" ? "en" : "es";
