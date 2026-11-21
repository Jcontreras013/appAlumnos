/**
 * Búsqueda en listas (alumnos, personal, centros): sin importar tildes ni mayúsculas, con las
 * palabras en cualquier orden y la identidad con o sin guiones. «martinez ana» encuentra a
 * «Martínez Brooks, Ana» y «08011985» encuentra «0801-1985-01234».
 */
export function searchText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesSearch(haystack: string, query: string): boolean {
  // Las «palabras» que son solo signos (un guion suelto) no cuentan.
  const words = searchText(query)
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/.test(w));
  if (words.length === 0) return true;
  const text = searchText(haystack);
  const compact = text.replace(/[^a-z0-9]/g, "");
  return words.every((word) => {
    if (text.includes(word)) return true;
    return compact.includes(word.replace(/[^a-z0-9]/g, ""));
  });
}
