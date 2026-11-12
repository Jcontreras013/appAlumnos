import "server-only";
import qrcode from "qrcode-generator";

/**
 * Código QR como trazo SVG (un cuadrito por módulo). Se dibuja en la página con un <path>, sin
 * imágenes externas ni HTML generado: la clave secreta nunca sale del servidor hacia otro servicio.
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  }
  return { size, d };
}
