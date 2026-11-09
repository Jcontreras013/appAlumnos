import { getSession } from "@/lib/dal";
import { identity } from "@/lib/identity";

/**
 * Logo del colegio del usuario. Pasa por el servidor de Next (BFF) porque identity no es accesible
 * desde internet. La URL lleva ?v=<versión>: al cambiar el logo cambia la URL y el navegador lo
 * vuelve a pedir; mientras tanto lo guarda en caché.
 */
export async function GET(request: Request) {
  const { accessToken } = await getSession();
  const logo = await identity.fetchLogo(accessToken);
  if (!logo) return new Response(null, { status: 404 });
  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(logo.body, {
    headers: {
      "content-type": logo.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
