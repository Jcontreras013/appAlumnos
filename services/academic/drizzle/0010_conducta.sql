CREATE TYPE "public"."conduct_category" AS ENUM('irrespeto', 'agresion', 'acoso', 'dano', 'fraude', 'fuga', 'objetos', 'otra');--> statement-breakpoint
CREATE TYPE "public"."conduct_measure" AS ENUM('llamado_atencion', 'citacion_familia', 'compromiso', 'suspension', 'expulsion');--> statement-breakpoint
CREATE TYPE "public"."conduct_severity" AS ENUM('leve', 'grave', 'muy_grave');--> statement-breakpoint
CREATE TABLE "conduct_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"date" date NOT NULL,
	"severity" "conduct_severity" NOT NULL,
	"category" "conduct_category" NOT NULL,
	"description" text NOT NULL,
	"reported_by_user_id" uuid NOT NULL,
	"reported_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conduct_incidents_tenant_key" UNIQUE("school_id","id")
);
--> statement-breakpoint
CREATE TABLE "conduct_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" "conduct_measure" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"notes" text NOT NULL,
	"decided_by_user_id" uuid NOT NULL,
	"decided_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	CONSTRAINT "conduct_measures_dates" CHECK (("conduct_measures"."kind" = 'suspension' and "conduct_measures"."ends_on" is not null and "conduct_measures"."ends_on" >= "conduct_measures"."starts_on") or ("conduct_measures"."kind" <> 'suspension' and "conduct_measures"."ends_on" is null))
);
--> statement-breakpoint
ALTER TABLE "conduct_incidents" ADD CONSTRAINT "conduct_incidents_student_fk" FOREIGN KEY ("school_id","student_id") REFERENCES "public"."students"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conduct_measures" ADD CONSTRAINT "conduct_measures_incident_fk" FOREIGN KEY ("school_id","incident_id") REFERENCES "public"."conduct_incidents"("school_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conduct_incidents_school_date_idx" ON "conduct_incidents" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "conduct_incidents_student_idx" ON "conduct_incidents" USING btree ("school_id","student_id","date");--> statement-breakpoint
CREATE INDEX "conduct_measures_incident_idx" ON "conduct_measures" USING btree ("school_id","incident_id");