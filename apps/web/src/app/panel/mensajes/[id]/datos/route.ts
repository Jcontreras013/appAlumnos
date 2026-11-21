import { z } from "zod";
import { identity } from "@/lib/identity";
import { relayJson } from "@/lib/relay";

const query = z.object({
  leer: z.enum(["1"]).optional(),
  antes: z.uuid().optional(),
});

/** Mensajes de la conversación: los nuevos (con `leer=1` mientras está a la vista) o los anteriores. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return Response.json({ error: "petición inválida" }, { status: 400 });
  }
  return relayJson(request, (token) =>
    identity.conversation(token, id, { read: parsed.data.leer === "1", before: parsed.data.antes }),
  );
}
