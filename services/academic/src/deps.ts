import type { FileStore } from "@escolar/service-kit";
import type { Db } from "./db/client";
import type { IdentityClient } from "./lib/identity-client";
import type { PlanDrafter } from "./lib/plan-assistant";

export interface AcademicDeps {
  db: Db;
  identity: IdentityClient;
  /** Fecha de hoy (AAAA-MM-DD, hora de Honduras). Se inyecta para poder probar fechas en los tests. */
  today: () => string;
  /** Asistente de planificación con IA; null si la instalación no lo tiene configurado. */
  planDrafter: PlanDrafter | null;
  /** Dónde se guardan los libros y documentos de la biblioteca (S3 en AWS, una carpeta en la demo). */
  files: FileStore;
  /** Llave de la instalación para cifrar las llaves secretas de la pasarela de cada centro. */
  paymentsKey: string | null;
}
