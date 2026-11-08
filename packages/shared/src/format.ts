/** RTN hondureño guardado como 14 dígitos => "0801-1990-123456". */
export function formatRtn(rtn: string | null | undefined): string {
  if (!rtn) return "—";
  const digits = rtn.replace(/\D/g, "");
  if (digits.length !== 14) return rtn;
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat("es-HN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Tegucigalpa",
});

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** Fecha de calendario AAAA-MM-DD => "08 de nov de 2026" (sin desfase por zona horaria). */
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  return formatDate(`${isoDate}T12:00:00Z`);
}
