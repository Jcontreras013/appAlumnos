import type { ImportSummaryDto, SchoolImportRowDto, StaffImportRowDto } from "@escolar/shared";

/** Estado del asistente de carga de cuentas (personal o centros). Seguro para el cliente. */
export interface AccountImportState {
  error?: string;
  result?: ImportSummaryDto<StaffImportRowDto> | ImportSummaryDto<SchoolImportRowDto>;
  /** Filas ya leídas del archivo, para confirmar sin volver a subirlo. */
  payload?: string;
  fileName?: string;
}
