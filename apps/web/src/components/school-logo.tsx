import type { SchoolDto } from "@escolar/shared";

/** Logo del colegio, o sus iniciales si todavía no subió uno. */
export function SchoolLogo({
  school,
  className = "size-10",
  scoped = false,
}: {
  school: Pick<SchoolDto, "id" | "name" | "logoVersion">;
  className?: string;
  /** true: logo de otro centro visto desde la departamental o distrital (no el de la sesión). */
  scoped?: boolean;
}) {
  if (school.logoVersion) {
    const src = scoped
      ? `/panel/logo/${school.id}?v=${school.logoVersion}`
      : `/panel/logo?v=${school.logoVersion}`;
    return (
      // biome-ignore lint/performance/noImgElement: imagen privada servida por /panel/logo (requiere sesión)
      <img
        src={src}
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
      className={`${className} grid shrink-0 place-items-center rounded-lg text-sm font-bold ${colorOf(school.id)}`}
      aria-hidden="true"
    >
      {initials || "C"}
    </span>
  );
}

/** Un color propio de cada centro (siempre el mismo), para que sus iniciales no se vean grises. */
const COLORS = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-indigo-100 text-indigo-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
];
function colorOf(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}
