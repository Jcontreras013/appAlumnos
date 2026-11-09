import { getSession } from "@/lib/dal";
import { identity } from "@/lib/identity";

/** Logo de un centro visto desde la dirección departamental o distrital (identity valida el ámbito). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accessToken } = await getSession();
  const logo = await identity.fetchScopedLogo(accessToken, id);
  if (!logo) return new Response(null, { status: 404 });
  return new Response(logo.body, {
    headers: {
      "content-type": logo.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
