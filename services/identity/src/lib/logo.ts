import type { LogoMimeType } from "@escolar/shared";

/**
 * Tipo real de la imagen según sus primeros bytes ("magic numbers"), sin confiar en la extensión
 * ni en lo que diga el navegador: un archivo renombrado a .png no pasa.
 */
export function detectImageType(data: Buffer): LogoMimeType | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
