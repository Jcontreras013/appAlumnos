import { z } from "zod";
import { identityUrl } from "@/lib/config";
import { relayUpload } from "@/lib/relay";

/** Sube una foto, un video o un documento a una conversación (el servicio de identidad lo revisa y lo guarda). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: { message: "Conversación inválida" } }, { status: 400 });
  return relayUpload(request, `${identityUrl()}/messages/conversations/${id}/attachments`);
}
