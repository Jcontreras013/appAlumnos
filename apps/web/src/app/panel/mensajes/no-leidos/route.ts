import { identity } from "@/lib/identity";
import { relayJson } from "@/lib/relay";

/** Para el contador del menú. */
export function GET(request: Request) {
  return relayJson(request, (token) => identity.unreadMessages(token));
}
