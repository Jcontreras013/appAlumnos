import type { SchoolDto } from "@escolar/shared";

/** Logo del colegio, o sus iniciales si todavía no subió uno. */
export function SchoolLogo({ school, className = "size-10" }: { school: SchoolDto; className?: string }) {
  if (school.logoVersion) {
    return (
      // biome-ignore lint/performance/noImgElement: imagen privada servida por /panel/logo (requiere sesión)
      <img
        src={`/panel/logo?v=${school.logoVersion}`}
        alt={`Logo de ${school.name}`}
        className={`${className} shrink-0 rounded-lg object-contain`}
      />
    );
  }
  const initials = school.name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600`}
      aria-hidden="true"
    >
      {initials || "C"}
    </span>
  );
}
