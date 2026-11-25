import { academic } from "@/lib/academic";
import { relayJson } from "@/lib/relay";

/** El chat de la clase, para que la pantalla se actualice sola. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "No encontrado" }, { status: 404 });
  return relayJson(request, (token) => academic.classChat(token, id));
}
