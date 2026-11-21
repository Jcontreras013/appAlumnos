import type { TokenSettings } from "./config";
import type { Db } from "./db/client";
import type { FileStore } from "./lib/files";
import type { SigningKeys } from "./lib/keys";
import type { PushSender } from "./lib/push";
import type { TokenService } from "./lib/tokens";

export interface IdentityDeps {
  db: Db;
  keys: SigningKeys;
  tokens: TokenService;
  settings: TokenSettings & {
    loginRateLimitPerMinute: number;
    /** Exigir verificación en dos pasos a los cargos regionales y de la plataforma (por defecto, sí). */
    requireMfa?: boolean;
  };
  /** Avisos al celular; null si la instalación no tiene llaves VAPID. */
  push: PushSender | null;
  /** Dónde se guardan las fotos, videos y documentos de los mensajes. */
  files: FileStore;
  /** Reloj (las pruebas lo fijan para revisar el horario de atención). */
  now: () => Date;
}
