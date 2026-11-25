import { z } from "zod";
import { academicUrl } from "@/lib/config";
import { relayUpload } from "@/lib/relay";

/** El alumno (o su familia, con ?alumno=) sube un archivo a su entrega. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: { message: "No encontrado" } }, { status: 404 });
  const alumno = new URL(request.url).searchParams.get("alumno");
  const query = alumno && z.uuid().safeParse(alumno).success ? `?alumno=${alumno}` : "";
  return relayUpload(request, `${academicUrl()}/class-tasks/${id}/submission/files${query}`);
}
