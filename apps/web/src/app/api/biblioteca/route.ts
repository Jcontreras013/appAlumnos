import { academicUrl } from "@/lib/config";
import { relayUpload } from "@/lib/relay";

/** Datos del material que acompañan al archivo (el cuerpo es el archivo). */
const FIELDS = ["titulo", "descripcion", "grado", "materia", "para"];

/** Sube un libro, guía o documento a la biblioteca (el servicio académico lo revisa y lo guarda). */
export async function POST(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const field of FIELDS) {
    const value = incoming.get(field);
    if (value) query.set(field, value.slice(0, 600));
  }
  return relayUpload(request, `${academicUrl()}/library/files?${query}`);
}
