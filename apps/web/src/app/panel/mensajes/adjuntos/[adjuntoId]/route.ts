import { z } from "zod";
import { identityUrl } from "@/lib/config";
import { relayFile } from "@/lib/relay";

/** Entrega una foto, un video o un documento de los mensajes (el servicio revisa que sea de la conversación). */
export async function GET(request: Request, { params }: { params: Promise<{ adjuntoId: string }> }) {
  const { adjuntoId } = await params;
  if (!z.uuid().safeParse(adjuntoId).success) return new Response("No encontrado", { status: 404 });
  return relayFile(request, `${identityUrl()}/messages/attachments/${adjuntoId}`);
}
