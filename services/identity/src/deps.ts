import type { TokenSettings } from "./config";
import type { Db } from "./db/client";
import type { SigningKeys } from "./lib/keys";
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
}
