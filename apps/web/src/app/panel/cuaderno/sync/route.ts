import { activityInputSchema, attendanceInputSchema, scoresInputSchema } from "@escolar/shared";
import { cookies } from "next/headers";
import { z } from "zod";
import { academic } from "@/lib/academic";
import { ServiceError } from "@/lib/api";
import type { SyncResult } from "@/lib/offline/sync";
import { ACCESS_COOKIE } from "@/lib/session-cookies";

const opSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("activity.put"), input: activityInputSchema }),
  z.object({ kind: z.literal("activity.delete"), id: z.uuid() }),
  z.object({ kind: z.literal("scores.put"), input: scoresInputSchema }),
  z.object({ kind: z.literal("attendance.put"), input: attendanceInputSchema }),
]);
const bodySchema = z.object({ ops: z.array(z.unknown()).min(1).max(50) });

const json = (status: number, body: unknown) => Response.json(body, { status });

/**
 * Recibe los cambios que el maestro hizo en el cuaderno (con o sin internet) y los aplica en orden.
 * Si el servidor de notas no responde, se detiene ahí: lo que falta se reintenta después. Un cambio
 * inválido (p. ej. una nota mayor al valor de la actividad) se rechaza sin frenar los demás.
 */
export async function POST(request: Request) {
  // Solo desde el propio panel (además de las cookies SameSite=Lax).
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return json(403, { error: "origen no permitido" });
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json(415, { error: "se espera JSON" });
  }
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return json(401, { error: "sesion" });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json(400, { error: "petición inválida" });

  const results: SyncResult[] = [];
  for (const raw of body.data.ops) {
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ ok: false, message: parsed.error.issues[0]?.message ?? "Cambio inválido" });
      continue;
    }
    const op = parsed.data;
    try {
      if (op.kind === "activity.put") await academic.putActivity(token, op.input);
      else if (op.kind === "activity.delete") await academic.deleteActivity(token, op.id);
      else if (op.kind === "scores.put") await academic.putScores(token, op.input);
      else await academic.putAttendance(token, op.input);
      results.push({ ok: true });
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      // Sesión vencida: lo ya aplicado queda; el resto se reenvía al volver a entrar.
      if (err.status === 401) return json(401, { error: "sesion", results });
      if (err.status >= 500 || err.status === 429) {
        results.push({ ok: false, retry: true, message: err.message });
        break;
      }
      results.push({ ok: false, message: err.message });
    }
  }
  return json(200, { results });
}
