import type { Role } from "@escolar/shared";
import type { Route } from "next";

export interface ModuleInfo {
  key: string;
  label: string;
  description: string;
  phase: number;
  roles: Role[];
  /** Si el módulo ya está disponible, a dónde lleva. */
  href?: Route;
}

/** Módulos de negocio y la fase del plan en la que llegan. */
export const MODULES: ModuleInfo[] = [
  {
    key: "matricula",
    label: "Matrícula y alumnos",
    description:
      "Alumnos, familias, grados y secciones con cupo, matrícula por año lectivo e importación desde Excel.",
    phase: 1,
    roles: ["admin", "secretaria", "coordinador"],
    href: "/panel/alumnos",
  },
  {
    key: "cuaderno",
    label: "Mi cuaderno",
    description:
      "Asistencia diaria y notas por actividad durante el parcial, desde el teléfono y aun sin internet. Al cierre, las notas quedan listas para el SACE.",
    phase: 3,
    roles: ["docente", "admin", "coordinador"],
    href: "/panel/cuaderno",
  },
  {
    key: "seguimiento",
    label: "Seguimiento y alerta temprana",
    description:
      "Avance de notas por clase, asistencia y alumnos en riesgo antes del cierre del parcial; cuadro de calificaciones para el SACE.",
    phase: 3,
    roles: ["admin", "coordinador", "secretaria"],
    href: "/panel/seguimiento",
  },
  {
    key: "planificacion",
    label: "Planificación semanal",
    description:
      "Cada maestro planifica sus clases de la semana con la plantilla del centro; la dirección o coordinación revisa, aprueba o devuelve con observaciones.",
    phase: 4,
    roles: ["admin", "coordinador", "docente", "secretaria"],
    href: "/panel/planificacion",
  },
  {
    key: "mis-hijos",
    label: "Mis hijos",
    description: "Notas por materia y parcial, asistencia, tareas de la semana y la boleta de cada hijo.",
    phase: 5,
    roles: ["padre"],
    href: "/panel/familia",
  },
  {
    key: "familias",
    label: "Portal de familias y boletas",
    description:
      "Desde la ficha de cada alumno se le da acceso a su familia (con su identidad) y se imprime su boleta.",
    phase: 5,
    roles: ["admin", "secretaria", "coordinador"],
    href: "/panel/alumnos",
  },
  {
    key: "facturacion",
    label: "Facturación",
    description:
      "Para colegios privados: colegiaturas, facturas con CAI, pagos en línea, mora y estados de cuenta.",
    phase: 6,
    roles: ["admin", "finanzas", "padre"],
  },
  {
    key: "wallet",
    label: "Wallet de cafetería",
    description:
      "Para colegios privados: saldo prepagado del alumno, recargas de los padres y consumos con carnet o QR.",
    phase: 6,
    roles: ["admin", "finanzas", "padre"],
  },
];
