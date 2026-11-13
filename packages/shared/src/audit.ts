/**
 * Bitácora del centro: lo que se registró en identity (accesos, cuentas) y en academic (alumnos,
 * estructura, notas, licencias…). La dirección la consulta; nadie la puede modificar.
 */
export interface AuditEventDto {
  id: string;
  source: "identity" | "academic";
  action: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

/** Nombre legible de cada acción. Si falta alguna, se muestra el código tal cual. */
export const AUDIT_LABELS: Record<string, string> = {
  "auth.login": "Inició sesión",
  "auth.switch": "Cambió de centro o de cargo",
  "auth.logout": "Cerró sesión",
  "auth.login_failed": "Intento de inicio de sesión fallido",
  "auth.locked": "Cuenta bloqueada por intentos fallidos",
  "auth.password_changed": "Cambió su contraseña",
  "auth.refresh_reuse_detected": "Sesión cerrada por un uso sospechoso",
  "auth.mfa_enabled": "Activó la verificación en dos pasos",
  "auth.mfa_recovery_used": "Entró con un código de recuperación",
  "account.updated": "Corrigió los datos de una cuenta",
  "account.password_reset": "Dio una contraseña temporal",
  "account.mfa_reset": "Restableció la verificación en dos pasos",
  "user.created": "Creó una cuenta",
  "user.activated": "Reactivó una cuenta",
  "user.deactivated": "Desactivó una cuenta",
  "users.imported": "Cargó personal desde Excel",
  "membership.created": "Dio acceso al centro a una cuenta existente",
  "membership.role_changed": "Cambió el cargo de una persona",
  "family_account.granted": "Dio acceso al portal de familias",
  "family_account.password_reset": "Dio una contraseña temporal a una familia",
  "family_account.revoked": "Quitó el acceso al portal de familias",
  "school.logo_updated": "Cambió el logo del centro",
  "school.logo_removed": "Quitó el logo del centro",
  "school_year.created": "Creó un año lectivo",
  "school_year.set_current": "Cambió el año lectivo vigente",
  "periods.updated": "Cambió las fechas de los parciales",
  "evaluation.passing_grade": "Cambió la nota mínima",
  "grade.updated": "Corrigió un grado",
  "grade.deleted": "Eliminó un grado",
  "section.updated": "Corrigió una sección",
  "section.deleted": "Eliminó una sección",
  "subject.updated": "Corrigió una materia",
  "subject.deleted": "Eliminó una materia",
  "assignment.created": "Asignó un docente a una clase",
  "assignment.teacher_changed": "Cambió el docente de una clase",
  "assignment.deleted": "Quitó una clase",
  "student.created": "Registró un alumno",
  "student.updated": "Corrigió los datos de un alumno",
  "students.imported": "Importó alumnos desde Excel",
  "student.guardian_added": "Agregó un responsable",
  "student.guardian_removed": "Quitó un responsable",
  "student.primary_guardian_changed": "Cambió el responsable principal",
  "guardian.updated": "Corrigió los datos de un responsable",
  "guardian.portal_access": "Dio acceso al portal a una familia",
  "guardian.portal_reset": "Dio una contraseña temporal a una familia",
  "guardian.portal_revoked": "Quitó el acceso al portal a una familia",
  "student.follow_up_added": "Registró un seguimiento",
  "student.follow_up_deleted": "Borró un seguimiento",
  "enrollment.created": "Matriculó a un alumno",
  "enrollment.reactivated": "Volvió a matricular a un alumno",
  "enrollment.transferred": "Cambió de sección a un alumno",
  "enrollment.withdrawn": "Registró el retiro de un alumno",
  "leave.created": "Registró una licencia",
  "leave.cancelled": "Canceló una licencia",
  "substitution.created": "Asignó un sustituto",
  "substitution.cancelled": "Canceló una sustitución",
  "activity.deleted": "Borró una actividad con notas",
  "plan_template.updated": "Cambió la plantilla de planificación",
  "announcement.published": "Publicó un aviso",
  "announcement.removed": "Quitó un aviso",
  "export.school": "Descargó los datos del centro en Excel",
  "schedule.blocks_updated": "Cambió las horas de clase",
  "schedule.section_updated": "Cambió el horario de una sección",
};

export const auditLabel = (action: string) => AUDIT_LABELS[action] ?? action;
