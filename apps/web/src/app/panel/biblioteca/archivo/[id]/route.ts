import { z } from "zod";
import { academicUrl } from "@/lib/config";
import { relayFile } from "@/lib/relay";

/**
 * Entrega el archivo de un material de la biblioteca a quien lo puede ver (lo revisa el servicio).
 * Está bajo /panel para que la sesión se renueve sola; el service worker guarda aquí los libros que
 * se eligen para leer sin internet.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("No encontrado", { status: 404 });
  return relayFile(request, `${academicUrl()}/library/${id}/file`);
}
