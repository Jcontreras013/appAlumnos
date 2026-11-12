/**
 * Indicadores del piloto: las metas de la propuesta a la Dirección Departamental, medidas con los
 * datos de la misma plataforma (sin encuestas aparte).
 */

export const PILOT_INDICATORS = [
  "centros_activos",
  "asistencia",
  "notas",
  "planificacion",
  "licencias",
  "alerta_temprana",
  "familias",
] as const;
export type PilotIndicator = (typeof PILOT_INDICATORS)[number];

export const PILOT_GOALS: Record<
  PilotIndicator,
  { label: string; goal: number; goalText: string; how: string }
> = {
  centros_activos: {
    label: "Centros con dirección y secretaría activas",
    goal: 1,
    goalText: "Todos los centros",
    how: "La dirección y la secretaría ya entraron y cambiaron su contraseña temporal.",
  },
  asistencia: {
    label: "Secciones que pasan asistencia",
    goal: 0.9,
    goalText: "90 % de las secciones, 4 de cada 5 días",
    how: "Días hábiles del período con lista de asistencia registrada en cada sección.",
  },
  notas: {
    label: "Clases con las notas del parcial completas",
    goal: 0.85,
    goalText: "85 % de las clases al cierre",
    how: "Último parcial cerrado (o el vigente): 100 puntos repartidos y todos los alumnos calificados.",
  },
  planificacion: {
    label: "Planificaciones entregadas",
    goal: 0.8,
    goalText: "80 % cada semana",
    how: "Promedio semanal de planificaciones entregadas a la dirección.",
  },
  licencias: {
    label: "Licencias registradas a tiempo y con sustituto",
    goal: 0.9,
    goalText: "90 % de las licencias",
    how: "Registradas a más tardar el día en que empiezan y con al menos una clase cubierta.",
  },
  alerta_temprana: {
    label: "Clases con notas suficientes para la alerta temprana",
    goal: 1,
    goalText: "Todas, 2 semanas antes del cierre",
    how: "Clases del parcial vigente con suficientes puntos evaluados para proyectar la nota.",
  },
  familias: {
    label: "Alumnos con una familia que ya usa el portal",
    goal: 0.4,
    goalText: "40 % de los alumnos",
    how: "Al menos un responsable del alumno entró al portal y cambió su contraseña temporal.",
  },
};

/** Un indicador: cuántos cumplen de cuántos (null = no hay nada que medir todavía). */
export interface PilotMeasure {
  met: number;
  total: number;
}

export const pilotRate = (m: PilotMeasure): number | null => (m.total > 0 ? m.met / m.total : null);

export interface PilotSchoolDto {
  schoolId: string;
  schoolName: string;
  districtName: string | null;
  measures: Record<PilotIndicator, PilotMeasure>;
}

export interface PilotIndicatorsDto {
  from: string;
  to: string;
  /** Días hábiles (lunes a viernes) del período, dentro del año lectivo. */
  businessDays: number;
  schools: PilotSchoolDto[];
  totals: Record<PilotIndicator, PilotMeasure>;
}

/** Lo que aporta identity: qué cuentas ya se usan en cada centro del ámbito. */
export interface ScopeActivityDto {
  schools: Array<{
    schoolId: string;
    directorActive: boolean;
    secretaryActive: boolean;
  }>;
  /** Cuentas de familia que ya entraron y cambiaron su contraseña temporal. */
  activatedFamilyUserIds: string[];
}
