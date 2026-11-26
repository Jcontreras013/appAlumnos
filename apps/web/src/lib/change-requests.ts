import "server-only";
import type { ChangeRequestKind } from "@escolar/shared";
import { academic } from "./academic";
import { identity } from "./identity";

/**
 * La secretaría pide algo (un grado, una sección, una materia, el permiso de un maestro): se guarda
 * como solicitud y se le manda un mensaje a la dirección para que la confirme. Si el mensaje no sale,
 * la solicitud queda igual en «Solicitudes» (y el menú de la dirección la cuenta).
 */
export async function requestFromDirection(
  token: string,
  kind: ChangeRequestKind,
  payload: Record<string, unknown>,
): Promise<string> {
  const request = await academic.createChangeRequest(token, kind, payload);
  try {
    const directors = (await identity.messageContacts(token)).filter((c) => c.role === "admin");
    for (const d of directors) {
      const { id } = await identity.startConversation(token, d.userId);
      await identity.sendMessage(
        token,
        id,
        `Solicitud para confirmar: ${request.summary}.\nConfírmala o recházala en «Solicitudes» (/panel/solicitudes).`,
      );
    }
  } catch {
    // El aviso por mensaje es una ayuda: la solicitud ya quedó guardada.
  }
  return `Se envió a la dirección para que la confirme: ${request.summary}.`;
}
