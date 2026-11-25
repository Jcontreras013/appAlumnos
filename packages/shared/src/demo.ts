import type { SchoolRole } from "./roles";

/**
 * Centro de demostración para enseñar CONECTA (y para la revisión de Google Play). Ficticio: todos
 * los nombres son inventados y los usuarios van en un subdominio de la empresa, que no recibe
 * correos. La contraseña de todas las cuentas es la de la demo (secreto DEMO_PASSWORD), nunca está en
 * el código. Lo arman el seed de identity (SEED_CENTRO_DEMO) y `seed-centro-demo` de academic.
 */
export const CENTRO_DEMO = {
  slug: "centro-demo-conecta",
  name: "Centro Educativo Demostración CONECTA",
  /** [cargo, nombre, usuario]. El orden importa: dirección primero y el maestro de la conversación quinto. */
  staff: [
    ["admin", "Marta Reyes", "direccion@demo.jcsystemhn.com"],
    ["coordinador", "Jorge Mejía", "coordinacion@demo.jcsystemhn.com"],
    ["secretaria", "Karla Funes", "secretaria@demo.jcsystemhn.com"],
    ["docente", "Lucía Paz", "maestra@demo.jcsystemhn.com"],
    ["docente", "Andrés Castillo", "maestro@demo.jcsystemhn.com"],
    ["docente", "Rosa Martínez", "primaria@demo.jcsystemhn.com"],
  ] as const satisfies ReadonlyArray<readonly [SchoolRole, string, string]>,
  /** La madre de Valeria (7.º) y de Mateo (1.º): ve a sus dos hijos. */
  family: { name: "Ana Gómez", email: "familia@demo.jcsystemhn.com" },
  /** La alumna con cuenta para mostrar el aula virtual. */
  student: { firstNames: "Valeria", lastNames: "Gómez Rivera", email: "alumna@demo.jcsystemhn.com" },
} as const;
