-- La bitácora de auditoría solo admite INSERT. Ni la aplicación ni un error humano en una consola
-- de base de datos pueden modificar o borrar el historial: este trigger lo impide.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events es de solo inserción (operación % no permitida)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
