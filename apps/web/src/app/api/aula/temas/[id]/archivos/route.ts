import { z } from "zod";
import { academicUrl } from "@/lib/config";
import { relayUpload } from "@/lib/relay";

/** Sube un archivo a un tema del aula virtual (el servicio académico revisa quién y qué). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: { message: "No encontrado" } }, { status: 404 });
  const titulo = new URL(request.url).searchParams.get("titulo")?.slice(0, 150);
  const query = new URLSearchParams(titulo ? { titulo } : {});
  return relayUpload(request, `${academicUrl()}/class-posts/${id}/files?${query}`);
}
