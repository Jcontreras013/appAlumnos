/**
 * Contraseñas fáciles de adivinar: las primeras que prueba cualquier ataque. No pretende ser una lista
 * completa (para eso está el límite de intentos), solo cerrar el paso a lo más obvio: palabras comunes
 * con números alrededor («Honduras2026!», «P@ssw0rd123»), solo números (como la identidad o el
 * teléfono), secuencias del teclado y un mismo carácter repetido.
 */
const COMMON_WORDS = new Set([
  "password",
  "contrasena",
  "micontrasena",
  "nuevacontrasena",
  "clave",
  "miclave",
  "secreto",
  "admin",
  "administrador",
  "administrator",
  "root",
  "usuario",
  "user",
  "login",
  "acceso",
  "bienvenido",
  "bienvenida",
  "welcome",
  "letmein",
  "cambiar",
  "cambiame",
  "temporal",
  "prueba",
  "test",
  "demo",
  "qwerty",
  "qwertyuiop",
  "asdfghjkl",
  "asdfghjklñ",
  "zxcvbnm",
  "abcdef",
  "abcdefg",
  "abcdefgh",
  "abcdefghij",
  "iloveyou",
  "teamo",
  "teamomucho",
  "honduras",
  "catracho",
  "catracha",
  "tegucigalpa",
  "sanpedrosula",
  "laceiba",
  "roatan",
  "escuela",
  "colegio",
  "instituto",
  "maestro",
  "maestra",
  "profesor",
  "profesora",
  "docente",
  "director",
  "directora",
  "secretaria",
  "seduc",
  "educacion",
  "estudiante",
  "alumno",
  "plataforma",
  "familia",
  "dios",
  "diosesamor",
  "jesus",
  "jesucristo",
  "princesa",
  "superman",
  "batman",
  "futbol",
  "football",
  "olimpia",
  "motagua",
  "barcelona",
  "realmadrid",
  "monkey",
  "dragon",
  "sunshine",
  "master",
]);

const SEQUENCES = [
  "01234567890123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiopasdfghjklzxcvbnm",
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm",
  "1q2w3e4r5t6y7u8i9o0p",
  "q1w2e3r4t5y6u7i8o9p0",
  "a1b2c3d4e5f6g7h8i9j0",
];

const LEET: Record<string, string> = {
  "@": "a",
  "4": "a",
  "3": "e",
  "1": "i",
  "!": "i",
  "0": "o",
  $: "s",
  "5": "s",
  "7": "t",
};

/** Sin tildes, en minúsculas y sin espacios ni separadores. */
function plain(password: string): string {
  return password
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s._\-+*/#=,;:'"()[\]{}<>|\\^~`¿?¡&%]+/g, "");
}

/** Por qué la contraseña es fácil de adivinar, o `null` si no lo es. */
export function weakPasswordReason(password: string): string | null {
  const p = plain(password);
  if (/^\d+$/.test(p)) {
    return "Agrega letras: una contraseña de solo números (como la identidad o el teléfono) es fácil de adivinar";
  }
  if (new Set(p).size <= 3) return "Usa más caracteres distintos: esa contraseña es fácil de adivinar";
  const sequence = (s: string) =>
    SEQUENCES.some((q) => q.includes(s) || [...q].reverse().join("").includes(s));
  // La palabra sin los números ni símbolos de los extremos, también escrita con números (p4ssw0rd).
  const core = p.replace(/^[\d@$!]+/, "").replace(/[\d@$!]+$/, "");
  const decoded = [...core].map((c) => LEET[c] ?? c).join("");
  if (sequence(p) || sequence(core) || COMMON_WORDS.has(core) || COMMON_WORDS.has(decoded)) {
    return "Esa contraseña es de las más usadas. Combina tres palabras y un número, por ejemplo: mango-río-4821-tarde";
  }
  return null;
}
