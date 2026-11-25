import { z } from "zod";
import { academicUrl } from "@/lib/config";
import { relayUpload } from "@/lib/relay";

/** El maestro adjunta un archivo a una tarea (una guía, una hoja de trabajo). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: { message: "No encontrado" } }, { status: 404 });
  return relayUpload(request, `${academicUrl()}/class-tasks/${id}/files`);
}
