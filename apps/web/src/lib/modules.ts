import type { Role } from "@escolar/shared";

/** Módulos de negocio y la fase del plan en la que llegan. */
export const MODULES: Array<{
  key: string;
  label: string;
  description: string;
  phase: number;
  roles: Role[];
}> = [
  {
    key: "matricula",
    label: "Matrícula y alumnos",
    description: "Alumnos, familias, grados y secciones, matrícula por año lectivo.",
    phase: 1,
    roles: ["admin", "secretaria"],
  },
  {
    key: "facturacion",
    label: "Facturación",
    description: "Colegiaturas, facturas con CAI, pagos, mora y estados de cuenta por familia.",
    phase: 2,
    roles: ["admin", "finanzas", "padre"],
  },
  {
    key: "wallet",
    label: "Wallet de cafetería",
    description: "Saldo prepagado del alumno: recargas de los padres y consumos con carnet o QR.",
    phase: 3,
    roles: ["admin", "finanzas", "padre"],
  },
  {
    key: "notas",
    label: "Notas y boletas",
    description: "Calificaciones por parcial, promedios y boletas en PDF.",
    phase: 4,
    roles: ["admin", "docente", "secretaria", "padre"],
  },
];
