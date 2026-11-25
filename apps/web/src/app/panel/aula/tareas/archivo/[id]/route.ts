import { z } from "zod";
import { academicUrl } from "@/lib/config";
import { relayFile } from "@/lib/relay";

/** Un archivo de una tarea (adjunto del maestro o de una entrega); el servicio revisa quién lo ve. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("No encontrado", { status: 404 });
  return relayFile(request, `${academicUrl()}/task-files/${id}/file`);
}
