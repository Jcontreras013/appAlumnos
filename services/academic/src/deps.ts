import type { Db } from "./db/client";
import type { IdentityClient } from "./lib/identity-client";

export interface AcademicDeps {
  db: Db;
  identity: IdentityClient;
  /** Fecha de hoy (AAAA-MM-DD, hora de Honduras). Se inyecta para poder probar fechas en los tests. */
  today: () => string;
}
