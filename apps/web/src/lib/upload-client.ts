/**
 * Sube un archivo desde el navegador a una ruta /api/… del panel (que lo pasa al servicio sin
 * guardarlo en memoria), con el avance para la barra. Si la sesión venció mientras se elegía el
 * archivo, la renueva y lo intenta otra vez.
 */
export interface UploadResult {
  status: number;
  body: unknown;
}

function send(url: string, file: File, contentType: string, onProgress: (f: number) => void) {
  return new Promise<UploadResult>((done) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // respuesta sin JSON
      }
      done({ status: xhr.status, body });
    };
    xhr.onerror = () => done({ status: 0, body: null });
    xhr.send(file);
  });
}

export async function uploadFile(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void = () => {},
): Promise<UploadResult> {
  let res = await send(url, file, contentType, onProgress);
  if (res.status === 401) {
    await fetch("/panel/sesion", { cache: "no-store" }).catch(() => {});
    res = await send(url, file, contentType, onProgress);
  }
  return res;
}

/** El mensaje para mostrar cuando la subida no salió bien. */
export function uploadError(res: UploadResult): string {
  if (res.status === 0) return "No se subió. Revisa tu conexión e intenta de nuevo.";
  return (
    (res.body as { error?: { message?: string } } | null)?.error?.message ?? "No se pudo subir el archivo."
  );
}
