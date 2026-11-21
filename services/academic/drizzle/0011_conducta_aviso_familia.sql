ALTER TABLE "conduct_measures" ADD COLUMN "notify_family" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- «Disciplina» (otra versión de este módulo) se unió a «Conducta». Si una base alcanzó a crear sus
-- tablas, se quitan; donde no existen, no pasa nada.
DROP TABLE IF EXISTS "discipline_records";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."discipline_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."discipline_severity";
