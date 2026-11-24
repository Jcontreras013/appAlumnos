import { z } from "zod";
import { academicUrl } from "@/lib/config";
import { relayFile } from "@/lib/relay";

/** Entrega un archivo de un tema del aula virtual a quien ve la clase (lo revisa el servicio). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("No encontrado", { status: 404 });
  return relayFile(request, `${academicUrl()}/class-materials/${id}/file`);
}
