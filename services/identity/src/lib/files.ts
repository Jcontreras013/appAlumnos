import { defaultFilesDir } from "@escolar/service-kit";

export { type FileStore, localFileStore, memoryFileStore, s3FileStore } from "@escolar/service-kit";

/** Carpeta por defecto de los adjuntos en desarrollo (fuera de git). */
export const DEFAULT_FILES_DIR = defaultFilesDir(".adjuntos");
