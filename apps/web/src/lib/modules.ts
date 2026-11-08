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
    key: "planificacion",
    label: "Planificación semanal",
    description:
      "Los docentes planifican cada semana; coordinación revisa, aprueba o devuelve con observaciones.",
    phase: 2,
    roles: ["admin", "coordinador", "docente"],
  },
  {
    key: "facturacion",
    label: "Facturación",
    description: "Colegiaturas, facturas con CAI, pagos en línea, mora y estados de cuenta por familia.",
    phase: 3,
    roles: ["admin", "finanzas", "padre"],
  },
  {
    key: "wallet",
    label: "Wallet de cafetería",
    description: "Saldo prepagado del alumno: recargas de los padres y consumos con carnet o QR.",
    phase: 4,
    roles: ["admin", "finanzas", "padre"],
  },
  {
    key: "notas",
    label: "Notas y boletas",
    description: "Calificaciones por parcial, promedios y boletas en PDF.",
    phase: 5,
    roles: ["admin", "coordinador", "docente", "secretaria", "padre"],
  },
];
