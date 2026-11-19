import { identity } from "@/lib/identity";
import { relayJson } from "@/lib/relay";

/** Mis conversaciones (la lista se actualiza sola mientras está abierta). */
export function GET(request: Request) {
  return relayJson(request, (token) => identity.conversations(token));
}
